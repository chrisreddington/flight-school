/**
 * Copilot SDK Server Utilities
 *
 * This module provides authentic Copilot SDK usage:
 * - Creative AI generation (daily focus, coaching)
 * - Multi-turn conversations (chat)
 * - MCP tool access for GitHub exploration
 *
 * All SDK operations are automatically logged to the AIActivityLogger.
 *
 * For data fetching, use `@/lib/github` instead (direct Octokit).
 */

import type { CopilotSession } from '@github/copilot-sdk';
import { nowMs } from '@/lib/utils/date-utils';

import { logger } from '@/lib/logger';
import { activityLogger, type CompleteOperation } from './activity/logger';
import type { AIActivityOutput } from './activity/types';
import {
    CHAT_SYSTEM_PROMPT,
    COACH_LIGHTWEIGHT_PROMPT,
    COACH_SYSTEM_PROMPT,
    GITHUB_CHAT_SYSTEM_PROMPT,
} from './prompts';
import {
    CHAT_MODEL,
    createSessionWithMetrics,
    getConversationSession,
    MODEL_TIERS,
} from './sessions';
import type {
    LoggedSessionResult,
    SessionCreationMetrics,
    ToolCallRecord,
} from './types';

const log = logger.withTag('Copilot SDK');

// =============================================================================
// Logged Session Wrapper
// =============================================================================

/**
 * Wraps a Copilot session with automatic activity logging.
 * 
 * This eliminates the need to manually set up event listeners and
 * call activityLogger in each API route. All SDK operations using
 * this wrapper will be automatically logged.
 * 
 * @param session - The Copilot session to wrap
 * @param operationName - Human-readable name for logging (e.g., "Focus Generation")
 * @param inputPrompt - The prompt being sent (truncated for logging)
 * @param model - The model being used (for activity tracking)
 * @returns Object with sendAndWait method that includes logging
 * 
 * @example
 * ```typescript
 * const session = await createCoachSession();
 * const logged = wrapSessionWithLogging(session, 'Focus Generation', prompt, 'gpt-5-mini');
 * const result = await logged.sendAndWait(prompt);
 * // Logging happens automatically - no manual activityLogger calls needed
 * ```
 */
export function wrapSessionWithLogging(
  session: CopilotSession,
  operationName: string,
  inputPrompt: string,
  model: string = MODEL_TIERS.standard,
  onDestroy?: () => void,
  sessionMetrics?: SessionCreationMetrics,
  destroyOnCleanup: boolean = true
): {
  sendAndWait: (prompt: string, timeout?: number) => Promise<LoggedSessionResult>;
  destroy: () => Promise<void>;
  /** The model used for this session */
  model: string;
  /** Session creation metrics for diagnostics */
  sessionMetrics?: SessionCreationMetrics;
} {
  const toolCalls: ToolCallRecord[] = [];
  let complete: CompleteOperation | null = null;

  // Set up event listeners for tool tracking
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

      // Log tool event to activity logger
      activityLogger.logEvent('tool', `mcp.${data.toolName}`, {
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
          `Tool complete: ${lastCall.name} (${lastCall.endTime - lastCall.startTime}ms)`
        );
      }
    }
  });

  return {
    /**
     * Send a prompt and wait for response with automatic logging.
     */
    async sendAndWait(prompt: string, timeout = 120000): Promise<LoggedSessionResult> {
      const startTime = nowMs();

      // Start logging the operation (includes model for activity panel)
      const metadata = sessionMetrics
        ? ({ ...sessionMetrics } as Record<string, unknown>)
        : undefined;

      complete = activityLogger.startOperation('ask', operationName, {
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

      try {
        log.info(`Sending prompt for: ${operationName}`);
        const response = await session.sendAndWait({ prompt }, timeout);

        let responseText = '';
        if (response) {
          responseText = (response.data as { content?: string })?.content || '';
        }
        log.info(`Response: ${responseText.length} chars`);

        const totalTimeMs = nowMs() - startTime;

        // Complete the logging with success
        const output: AIActivityOutput = {
          text: responseText.slice(0, 100),
          fullResponse: responseText,
          toolsUsed: toolCalls.map((t) => t.name),
          metadata: { toolsUsed: toolCalls.map((t) => t.name) },
        };
        complete(output);

        return {
          responseText,
          toolCalls,
          totalTimeMs,
        };
      } catch (error) {
        const totalTimeMs = nowMs() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        // Complete the logging with error
        complete(undefined, errorMessage);

        log.error(`Error after ${totalTimeMs}ms:`, errorMessage);
        throw error;
      }
    },

    /**
     * Destroy the session (cleanup).
     * Note: Fire-and-forget to avoid blocking response.
     */
    async destroy(): Promise<void> {
      onDestroy?.();
      if (destroyOnCleanup) {
        // Don't await - fire and forget to avoid blocking the response
        session.destroy().catch((err) => {
          log.warn('Session destroy warning:', err);
        });
      }
    },

    /** The model used for this session */
    model,
    sessionMetrics,
  };
}

/**
 * Create a logged coach session for focus generation.
 * 
 * This is a convenience function that creates a coach session
 * with automatic activity logging built in.
 * 
 * @param operationName - Name for logging (default: "Coach Session")
 * @param inputPrompt - The prompt being sent (for logging context)
 * @returns Wrapped session with logging
 */
export async function createLoggedCoachSession(
  operationName = 'Coach Session',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await createSessionWithMetrics({
    includeMcpTools: true,
    tools: ['get_me', 'list_user_repositories'],
    systemMessage: COACH_SYSTEM_PROMPT,
  }, 'coach:mcp');
  return wrapSessionWithLogging(
    session,
    operationName,
    inputPrompt,
    MODEL_TIERS.standard,
    undefined, // No pool replenishment
    metrics
  );
}

/**
 * Create a logged coach session without MCP tools (lightweight/fast).
 * 
 * @param operationName - Name for logging
 * @param inputPrompt - Initial prompt context
 * @returns Logged session wrapper
 */
export async function createLoggedLightweightCoachSession(
  operationName = 'Coach Session (fast)',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await createSessionWithMetrics({
    includeMcpTools: false,
    systemMessage: COACH_LIGHTWEIGHT_PROMPT,
  }, 'coach:lightweight');
  return wrapSessionWithLogging(
    session,
    operationName,
    inputPrompt,
    MODEL_TIERS.standard,
    undefined, // No pool replenishment
    metrics
  );
}

/**
 * Create a logged chat session for conversations.
 * 
 * This creates a LIGHTWEIGHT session without MCP tools for fast responses.
 * For GitHub exploration, use createLoggedGitHubChatSession instead.
 * 
 * @param operationName - Name for logging (default: "Chat Session")
 * @param inputPrompt - The prompt being sent (for logging context)
 * @returns Wrapped session with logging
 */
export async function createLoggedChatSession(
  operationName = 'Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await getConversationSession(conversationId, 'chat:lightweight', {
    includeMcpTools: false,
    model: CHAT_MODEL,
    systemMessage: CHAT_SYSTEM_PROMPT,
  });
  return wrapSessionWithLogging(
    session,
    operationName,
    inputPrompt,
    CHAT_MODEL,
    undefined, // No pool replenishment
    metrics,
    !conversationId
  );
}

/**
 * Create a logged chat session WITH GitHub MCP tools.
 * 
 * Use this when the user wants to explore repos, search code, etc.
 * Slower to create due to MCP configuration, but enables GitHub access.
 * 
 * @param operationName - Name for logging
 * @param inputPrompt - The prompt being sent (for logging context)
 * @returns Wrapped session with logging
 */
export async function createLoggedGitHubChatSession(
  operationName = 'GitHub Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const chatTools = process.env.COPILOT_GITHUB_MCP_TOOLS?.split(',').map((tool) => tool.trim()).filter(Boolean);
  const { session, metrics } = await getConversationSession(conversationId, 'chat:mcp', {
    includeMcpTools: true,
    model: CHAT_MODEL,
    ...(chatTools && chatTools.length > 0 && { tools: chatTools }),
    systemMessage: GITHUB_CHAT_SYSTEM_PROMPT,
  });
  return wrapSessionWithLogging(
    session,
    operationName,
    inputPrompt,
    CHAT_MODEL,
    undefined, // No pool replenishment
    metrics,
    !conversationId
  );
}
