/**
 * Internal Copilot streaming session factory. Wires up an SDK conversation
 * session, translates SDK events into our `StreamEvent` union, and emits
 * telemetry on completion. The public `streaming.ts` entry points wrap this
 * with the appropriate system prompt and pool key.
 */

import { logger } from '@/lib/logger';
import {
  GEN_AI_OPERATION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_GITHUB_COPILOT,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  INSTRUMENTATION_SCOPE_SERVER,
  INSTRUMENTATION_SCOPE_VERSION,
} from '@/lib/observability/semconv';
import { context, trace } from '@opentelemetry/api';

import { activityLogger } from './activity/logger';
import {
  CHAT_MODEL,
  getCopilotGithubMcpTools,
  getConversationSession,
} from './sessions';
import {
  type StreamContext,
  pumpEventQueue,
  recordTerminalError,
  recordTerminalSuccess,
} from './streaming-telemetry';
import type { StreamEvent, StreamingSession, StreamingToolCall } from './types';

/** Configuration for creating a streaming session. */
export interface StreamingSessionConfig {
  prompt: string;
  useGitHubTools: boolean;
  operationName: string;
  conversationId?: string;
  systemMessage: string;
  /** Pool key prefix (e.g., 'chat' or 'learning') */
  poolKeyPrefix: string;
  /** Tag for logger output */
  logPrefix: string;
  userId: string;
  gitHubToken: string;
}

/**
 * Generic streaming session factory used by chat, learning, and evaluation
 * flows. All public factories funnel through this; the only thing that varies
 * is the system message and pool key.
 *
 * @internal
 */
export async function createGenericStreamingSession(
  config: StreamingSessionConfig,
): Promise<StreamingSession> {
  const {
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage,
    poolKeyPrefix,
    logPrefix,
    userId,
    gitHubToken,
  } = config;
  const startTime = Date.now();
  const log = logger.withTag(logPrefix);
  const model = CHAT_MODEL;

  const poolKey = useGitHubTools ? `${poolKeyPrefix}:mcp` : `${poolKeyPrefix}:lightweight`;

  const githubMcpTools = getCopilotGithubMcpTools();
  const { session, metrics } = useGitHubTools
    ? await getConversationSession(userId, conversationId, poolKey, {
        includeMcpTools: true,
        model,
        ...(githubMcpTools.length > 0 ? { tools: githubMcpTools } : {}),
        systemMessage,
        userId,
        gitHubToken,
      })
    : await getConversationSession(userId, conversationId, poolKey, {
        includeMcpTools: false,
        model,
        systemMessage,
        userId,
        gitHubToken,
      });

  const toolCalls: StreamingToolCall[] = [];
  let totalContent = '';

  const { eventId: activityEventId, complete } = await activityLogger.startOperation(
    userId,
    'ask',
    operationName,
    {
      prompt: prompt.slice(0, 100),
      model,
      sessionMetrics: metrics
        ? {
            poolHit: !metrics.createdNew,
            sessionCreateMs: metrics.sessionCreateMs,
            mcpEnabled: metrics.mcpEnabled,
            conversationReused: metrics.reusedConversation,
          }
        : undefined,
      // Server-side metrics are placeholders until the stream terminates.
      serverMetrics: { firstTokenMs: null, totalMs: 0 },
    },
  );

  const streamingMetrics = {
    firstDeltaMs: null as number | null,
    activityEventId: activityEventId ?? undefined,
  };
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION);

  async function* generateStream(): AsyncGenerator<StreamEvent, void, unknown> {
    const streamSpan = tracer.startSpan(`${GEN_AI_OPERATION.CHAT} ${model}`, {
      attributes: {
        [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CHAT,
        [GEN_AI_REQUEST_MODEL]: model,
        [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
        'app.operation': operationName,
        'ai.mcp_enabled': useGitHubTools,
      },
    });
    streamSpan.addEvent('stream.started');

    let resolveIdle: (() => void) | null = null;
    let rejectWithError: ((err: Error) => void) | null = null;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    const eventQueue: StreamEvent[] = [];
    let queueResolver: (() => void) | null = null;
    let deltaCount = 0;
    let deltaBytes = 0;
    const usageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    const unsubscribe = session.on((event) => {
      const eventType = event.type;

      if (eventType === 'assistant.message_delta') {
        const deltaPayload = event.data as { deltaContent?: string };
        if (deltaPayload.deltaContent) {
          if (streamingMetrics.firstDeltaMs === null) {
            streamingMetrics.firstDeltaMs = Date.now() - startTime;
            streamSpan.addEvent('first_token', {
              'ai.stream.first_delta_ms': streamingMetrics.firstDeltaMs,
            });
          }
          deltaCount += 1;
          deltaBytes += Buffer.byteLength(deltaPayload.deltaContent);
          totalContent += deltaPayload.deltaContent;
          eventQueue.push({ type: 'delta', content: deltaPayload.deltaContent });
          queueResolver?.();
        }
      } else if (eventType === 'assistant.usage') {
        // Accumulate token counts; we record once on stream completion so the
        // histogram sample reflects the whole turn rather than per-chunk noise.
        const usagePayload = event.data as {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
        usageTotals.inputTokens += usagePayload.inputTokens ?? 0;
        usageTotals.outputTokens += usagePayload.outputTokens ?? 0;
        usageTotals.cacheReadTokens += usagePayload.cacheReadTokens ?? 0;
        usageTotals.cacheWriteTokens += usagePayload.cacheWriteTokens ?? 0;
      } else if (eventType === 'tool.execution_start') {
        const toolStart = event.data as { toolName: string; arguments: unknown };
        log.debug(`Tool start: ${toolStart.toolName}`);
        streamSpan.addEvent('tool.start', { 'tool.name': toolStart.toolName });
        toolCalls.push({
          name: toolStart.toolName,
          args: toolStart.arguments,
          result: '',
          startTime: Date.now(),
        });
        eventQueue.push({
          type: 'tool_start',
          name: toolStart.toolName,
          args: toolStart.arguments,
        });
        queueResolver?.();

        activityLogger.logEvent(userId, 'tool', `mcp.${toolStart.toolName}`, {
          metadata: { args: toolStart.arguments },
        });
      } else if (eventType === 'tool.execution_complete') {
        const lastCall = toolCalls[toolCalls.length - 1];
        const toolComplete = event.data as { result?: unknown };
        if (lastCall) {
          lastCall.result = String(toolComplete.result || '').slice(0, 500);
          lastCall.endTime = Date.now();
          const duration = lastCall.endTime - lastCall.startTime;
          log.debug(`Tool complete: ${lastCall.name} (${duration}ms)`);
          streamSpan.addEvent('tool.complete', {
            'tool.name': lastCall.name,
            'tool.duration_ms': duration,
          });
          eventQueue.push({
            type: 'tool_complete',
            name: lastCall.name,
            result: lastCall.result,
            duration,
          });
          queueResolver?.();
        }
      } else if (eventType === 'session.idle') {
        resolveIdle?.();
      } else if (eventType === 'session.error') {
        const errorPayload = event.data as { message?: string };
        rejectWithError?.(new Error(errorPayload.message || 'Session error'));
      }
    });

    const buildContext = (): StreamContext => ({
      model,
      useGitHubTools,
      metrics,
      startTime,
      streamingMetrics,
      toolCalls,
      usageTotals,
      totalContent,
      deltaCount,
      deltaBytes,
    });

    try {
      const activeContext = trace.setSpan(context.active(), streamSpan);
      await context.with(activeContext, async () => {
        await session.send({ prompt });
      });

      yield* pumpEventQueue(eventQueue, idlePromise, (resolver) => {
        queueResolver = resolver;
      });

      const durationMs = recordTerminalSuccess(buildContext(), streamSpan, complete);
      yield { type: 'done', totalContent, toolCalls, durationMs };
    } catch (error) {
      const errorMessage = recordTerminalError(buildContext(), streamSpan, complete, error);
      yield { type: 'error', message: errorMessage };
    } finally {
      unsubscribe();
      streamSpan.end();
    }
  }

  return {
    stream: generateStream(),
    cleanup: () => {
      if (!conversationId) {
        session.destroy().catch((err) => {
          log.warn('Session destroy warning:', err);
        });
      }
    },
    model,
    sessionMetrics: metrics,
    streamingMetrics,
  };
}
