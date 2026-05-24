/**
 * Streaming telemetry primitives shared by every Copilot streaming session:
 * the mutable per-invocation context, the event-queue pump, and the terminal
 * success/error recorders that emit OTel spans + activity-log completions.
 */

import {
  recordAiOperation,
  recordAiStreamMetrics,
  recordAiTokenUsage,
} from '@/lib/observability/telemetry';
import { GEN_AI_OPERATION } from '@/lib/observability/semconv';
import { type Span, SpanStatusCode } from '@opentelemetry/api';

import type { BaseProfileId } from './profile-types';
import type { StreamEvent, StreamingToolCall } from './types';

/**
 * Mutable state shared between the SDK event handler, the yield loop, and the
 * terminal recorders. Fields are split into readonly metadata + mutable
 * counters; we mutate in place rather than rebuilding the object per delta.
 */
export interface StreamContext {
  readonly model: string;
  readonly profile: BaseProfileId;
  /** True when `resolveProfile` auto-elevated a capability (telemetry). */
  readonly wasAutoElevated: boolean;
  readonly mcpServerCount: number;
  readonly metrics: { createdNew: boolean } | undefined;
  readonly startTime: number;
  readonly streamingMetrics: { firstDeltaMs: number | null };
  readonly toolCalls: StreamingToolCall[];
  readonly usageTotals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  totalContent: string;
  deltaCount: number;
  deltaBytes: number;
}

const STREAM_POLL_INTERVAL_MS = 20;

/**
 * Drains the event queue (yielding any pending items) and waits up to
 * `STREAM_POLL_INTERVAL_MS` for the next event or session idle. Returns once
 * the SDK signals end-of-turn.
 */
export async function* pumpEventQueue(
  eventQueue: StreamEvent[],
  idlePromise: Promise<void>,
  setQueueResolver: (resolver: () => void) => void,
): AsyncGenerator<StreamEvent, void, unknown> {
  while (true) {
    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }
    const raceResult = await Promise.race([
      idlePromise.then(() => 'idle' as const),
      new Promise<'more'>((resolve) => {
        setQueueResolver(() => resolve('more'));
        setTimeout(() => resolve('more'), STREAM_POLL_INTERVAL_MS);
      }),
    ]);
    if (raceResult === 'idle') {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      return;
    }
  }
}

/**
 * Emit terminal-success telemetry: activity-logger completion, stream
 * histogram sample, operation count, token-usage histogram, and span status.
 */
export function recordTerminalSuccess(
  ctx: StreamContext,
  streamSpan: Span,
  complete: (
    response: { text: string; fullResponse: string; toolsUsed: string[]; metadata: Record<string, unknown> },
    errorMessage: string | undefined,
    serverMetrics: { firstTokenMs: number | null; totalMs: number },
  ) => void,
): number {
  const durationMs = Date.now() - ctx.startTime;
  const toolsUsed = ctx.toolCalls.map((toolCall) => toolCall.name);

  complete(
    {
      text: ctx.totalContent.slice(0, 100),
      fullResponse: ctx.totalContent,
      toolsUsed,
      metadata: {
        toolsUsed,
        firstTokenMs: ctx.streamingMetrics.firstDeltaMs,
      },
    },
    undefined,
    {
      firstTokenMs: ctx.streamingMetrics.firstDeltaMs,
      totalMs: durationMs,
    },
  );

  recordAiStreamMetrics({
    model: ctx.model,
    mcpEnabled: ctx.mcpServerCount > 0,
    poolHit: ctx.metrics ? !ctx.metrics.createdNew : null,
    firstTokenMs: ctx.streamingMetrics.firstDeltaMs,
    durationMs,
    deltaCount: ctx.deltaCount,
    deltaBytes: ctx.deltaBytes,
    toolCalls: ctx.toolCalls.length,
    terminalState: 'completed',
  });
  recordAiOperation('streamSession', durationMs, ctx.model, 'ok');
  recordAiTokenUsage({
    operation: GEN_AI_OPERATION.CHAT,
    model: ctx.model,
    inputTokens: ctx.usageTotals.inputTokens,
    outputTokens: ctx.usageTotals.outputTokens,
    cacheReadTokens: ctx.usageTotals.cacheReadTokens,
    cacheWriteTokens: ctx.usageTotals.cacheWriteTokens,
  });
  streamSpan.addEvent('stream.completed', {
    'ai.stream.delta_count': ctx.deltaCount,
    'ai.stream.delta_bytes': ctx.deltaBytes,
    'ai.stream.tool_calls': ctx.toolCalls.length,
  });
  streamSpan.setStatus({ code: SpanStatusCode.OK });
  return durationMs;
}

/**
 * Emit terminal-error telemetry: stream histogram sample with `'error'`
 * terminal state, operation count, span exception/status, and activity-
 * logger error completion.
 */
export function recordTerminalError(
  ctx: StreamContext,
  streamSpan: Span,
  complete: (response: undefined, errorMessage: string) => void,
  error: unknown,
): string {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const durationMs = Date.now() - ctx.startTime;
  recordAiOperation('streamSession', durationMs, ctx.model, 'error');
  recordAiStreamMetrics({
    model: ctx.model,
    mcpEnabled: ctx.mcpServerCount > 0,
    poolHit: ctx.metrics ? !ctx.metrics.createdNew : null,
    firstTokenMs: ctx.streamingMetrics.firstDeltaMs,
    durationMs,
    deltaCount: ctx.deltaCount,
    deltaBytes: ctx.deltaBytes,
    toolCalls: ctx.toolCalls.length,
    terminalState: 'error',
  });
  streamSpan.addEvent('stream.failed', { message: errorMessage });
  if (error instanceof Error) {
    streamSpan.recordException(error);
  }
  streamSpan.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
  complete(undefined, errorMessage);
  return errorMessage;
}
