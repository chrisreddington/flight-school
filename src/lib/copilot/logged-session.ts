import type { CopilotSession } from '@github/copilot-sdk';
import { nowMs } from '@/lib/utils/date-utils';

import { logger } from '@/lib/logger';
import { recordAiOperation, recordAiTokenUsage, setSpanError, withSpan } from '@/lib/observability/telemetry';
import {
  GEN_AI_OPERATION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_GITHUB_COPILOT,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
} from '@/lib/observability/semconv';
import { activityLogger, type CompleteOperation } from './activity/logger';
import type { AIActivityOutput } from './activity/types';
import type {
  LoggedSessionResult,
  SessionCreationMetrics,
  ToolCallRecord,
} from './types';

const log = logger.withTag('Copilot SDK');

export interface LoggedCopilotSession {
  sendAndWait: (prompt: string, timeout?: number) => Promise<LoggedSessionResult>;
  destroy: () => Promise<void>;
  /** The model used for this session */
  model: string;
  /** Session creation metrics for diagnostics */
  sessionMetrics?: SessionCreationMetrics;
}

/**
 * Wraps a Copilot session with automatic activity logging.
 */
export function wrapSessionWithLogging(
  userId: string,
  session: CopilotSession,
  operationName: string,
  inputPrompt: string,
  model: string,
  onDestroy?: () => void,
  sessionMetrics?: SessionCreationMetrics,
  destroyOnCleanup = true,
): LoggedCopilotSession {
  const toolCalls: ToolCallRecord[] = [];
  let complete: CompleteOperation | null = null;
  const usageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  session.on((event) => {
    const eventType = event.type;

    if (eventType === 'tool.execution_start') {
      const data = event.data;
      log.debug(`Tool start: ${data.toolName}`);
      toolCalls.push({
        name: data.toolName,
        args: data.arguments,
        result: '',
        startTime: nowMs(),
      });

      activityLogger.logEvent(userId, 'tool', `mcp.${data.toolName}`, {
        metadata: { args: data.arguments },
      });
    }

    if (eventType === 'tool.execution_complete') {
      const lastCall = toolCalls[toolCalls.length - 1];
      const data = event.data;
      if (lastCall) {
        lastCall.result = String(data.result || '').slice(0, 500);
        lastCall.endTime = nowMs();
        log.debug(
          `Tool complete: ${lastCall.name} (${lastCall.endTime - lastCall.startTime}ms)`,
        );
      }
    }

    if (eventType === 'assistant.usage') {
      // The SDK emits one or more `assistant.usage` events per turn (e.g.
      // multiple inferences across tool hops). Accumulate so the histogram
      // is recorded once per `sendAndWait` rather than per delta event.
      const data = event.data;
      usageTotals.inputTokens += data.inputTokens ?? 0;
      usageTotals.outputTokens += data.outputTokens ?? 0;
      usageTotals.cacheReadTokens += data.cacheReadTokens ?? 0;
      usageTotals.cacheWriteTokens += data.cacheWriteTokens ?? 0;
    }
  });

  return {
    async sendAndWait(prompt: string, timeout = 120000): Promise<LoggedSessionResult> {
      const startTime = nowMs();
      const metadata = sessionMetrics
        ? ({ ...sessionMetrics } as Record<string, unknown>)
        : undefined;

      const started = await activityLogger.startOperation(userId, 'ask', operationName, {
        prompt: inputPrompt.slice(0, 100),
        model,
        metadata,
        sessionMetrics: sessionMetrics ? {
          poolHit: !sessionMetrics.createdNew,
          sessionCreateMs: sessionMetrics.sessionCreateMs,
          mcpEnabled: sessionMetrics.mcpEnabled,
          conversationReused: sessionMetrics.reusedConversation,
        } : undefined,
      });
      complete = started.complete;

      try {
        log.info(`Sending prompt for: ${operationName}`);
        const response = await withSpan(
          `${GEN_AI_OPERATION.CHAT} ${model}`,
          {
            [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CHAT,
            [GEN_AI_REQUEST_MODEL]: model,
            [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
            'app.operation': operationName,
          },
          async (span) => {
            try {
              return await session.sendAndWait({ prompt }, timeout);
            } catch (error) {
              setSpanError(span, error);
              throw error;
            }
          },
        );

        const responseText = response
          ? (response.data as { content?: string })?.content || ''
          : '';
        log.info(`Response: ${responseText.length} chars`);

        const totalTimeMs = nowMs() - startTime;
        const output: AIActivityOutput = {
          text: responseText.slice(0, 100),
          fullResponse: responseText,
          toolsUsed: toolCalls.map((toolCall) => toolCall.name),
          metadata: { toolsUsed: toolCalls.map((toolCall) => toolCall.name) },
        };
        complete(output);
        recordAiOperation('sendAndWait', totalTimeMs, model, 'ok');
        recordAiTokenUsage({
          operation: GEN_AI_OPERATION.CHAT,
          model,
          inputTokens: usageTotals.inputTokens,
          outputTokens: usageTotals.outputTokens,
          cacheReadTokens: usageTotals.cacheReadTokens,
          cacheWriteTokens: usageTotals.cacheWriteTokens,
        });

        return {
          responseText,
          toolCalls,
          totalTimeMs,
        };
      } catch (error) {
        const totalTimeMs = nowMs() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        complete(undefined, errorMessage);
        log.error(`Error after ${totalTimeMs}ms:`, errorMessage);
        recordAiOperation('sendAndWait', totalTimeMs, model, 'error');
        throw error;
      }
    },

    async destroy(): Promise<void> {
      onDestroy?.();
      if (destroyOnCleanup) {
        session.destroy().catch((err) => {
          log.warn('Session destroy warning:', err);
        });
      }
    },

    model,
    sessionMetrics,
  };
}
