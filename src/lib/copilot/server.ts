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
import { recordAiOperation, setSpanError, withSpan } from '@/lib/observability/telemetry';
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
import { getCopilotGithubMcpTools } from './mcp-tools';
import type { SessionIdentity } from './session-identity';
import { createSessionIdentity } from './session-identity';
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
 * @param onDestroy - Optional hook fired synchronously when the returned
 *   wrapper's `.destroy()` is called, **before** the underlying SDK session is
 *   torn down. Use for pool replenishment or cache eviction.
 * @param sessionMetrics - Optional session-creation diagnostics (pool hit,
 *   create latency, MCP enabled, conversation reuse). Forwarded to the
 *   activity logger so the activity panel can attribute first-token latency.
 * @param destroyOnCleanup - When `true` (default) the wrapper's `.destroy()`
 *   also destroys the underlying SDK session. Pass `false` for sessions
 *   owned by an external cache (e.g. multi-turn conversations) whose
 *   lifecycle is managed by the cache, not the per-turn wrapper.
 * @returns Object with sendAndWait method that includes logging
 * 
 * @example
 * ```typescript
 * const session = await createCoachSession();
 * const logged = wrapSessionWithLogging(userId, session, 'Focus Generation', prompt, 'gpt-5-mini');
 * const result = await logged.sendAndWait(prompt);
 * // Logging happens automatically - no manual activityLogger calls needed
 * ```
 */
export function wrapSessionWithLogging(
  userId: string,
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

      complete = activityLogger.startOperation(userId, 'ask', operationName, {
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
        const response = await withSpan(
          'copilot.session.send_and_wait',
          {
            'ai.operation': operationName,
            'ai.model': model,
          },
          async (span) => {
            try {
              return await session.sendAndWait({ prompt }, timeout);
            } catch (error) {
              setSpanError(span, error);
              throw error;
            }
          }
        );

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
        recordAiOperation('sendAndWait', totalTimeMs, model, 'ok');

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
        recordAiOperation('sendAndWait', totalTimeMs, model, 'error');
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

export { createSessionIdentity, type SessionIdentity } from './session-identity';

/**
 * Create a logged coach session **with** GitHub MCP tools (`get_me`,
 * `list_user_repositories`) for focus generation.
 *
 * @param identity - Per-request {@link SessionIdentity}. Carries the
 *   multi-tenant invariant: the session acts as `identity.userId` and the
 *   SDK uses `identity.gitHubToken` for MCP calls — never the ambient
 *   `GITHUB_TOKEN`.
 * @param operationName - Human-readable label written to the activity log.
 *   Defaults to `'Coach Session'`.
 * @param inputPrompt - Initial prompt snippet captured for log context
 *   only; does not pre-seed the session.
 * @returns A logging-wrapped session for a single coach turn. **Lifecycle:**
 *   callers MUST call `.destroy()` (typically in a `finally`) to release
 *   the underlying SDK session and any MCP resources.
 * @throws When the Copilot SDK rejects `identity.gitHubToken` (401/403,
 *   expired token, missing scopes) or MCP server initialisation fails.
 *
 * @example
 * ```typescript
 * const { userId, accessToken } = await requireUserContext();
 * const logged = await createLoggedCoachSession(
 *   \{ userId, gitHubToken: accessToken \},
 *   'Daily Focus',
 *   userPrompt,
 * );
 * try \{
 *   const result = await logged.sendAndWait(userPrompt);
 *   return result.text;
 * \} finally \{
 *   await logged.destroy();
 * \}
 * ```
 */
export async function createLoggedCoachSession(
  identity: SessionIdentity,
  operationName = 'Coach Session',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await createSessionWithMetrics({
    includeMcpTools: true,
    tools: ['get_me', 'list_user_repositories'],
    systemMessage: COACH_SYSTEM_PROMPT,
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  }, 'coach:mcp');
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    MODEL_TIERS.standard,
    undefined, // No pool replenishment
    metrics
  );
}

/**
 * Create a lightweight logged coach session **without** MCP tools. Faster
 * to spin up than {@link createLoggedCoachSession}; use when the coach turn
 * doesn't need to read repos.
 *
 * @param identity - Per-request {@link SessionIdentity}; same multi-tenant
 *   contract as {@link createLoggedCoachSession}.
 * @param operationName - Activity-log label. Defaults to
 *   `'Coach Session (fast)'`.
 * @param inputPrompt - Prompt snippet captured for log context only.
 * @returns A logging-wrapped session for one fast coach turn. Callers MUST
 *   call `.destroy()` to release SDK resources.
 * @throws When the Copilot SDK rejects `identity.gitHubToken` (401/403 or
 *   expired/invalid credential).
 */
export async function createLoggedLightweightCoachSession(
  identity: SessionIdentity,
  operationName = 'Coach Session (fast)',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await createSessionWithMetrics({
    includeMcpTools: false,
    model: MODEL_TIERS.fastChat,
    systemMessage: COACH_LIGHTWEIGHT_PROMPT,
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  }, 'coach:lightweight');
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    MODEL_TIERS.fastChat,
    undefined, // No pool replenishment
    metrics
  );
}

/**
 * Create a logged chat session for multi-turn conversations. Lightweight —
 * **no** MCP tools, so responses are fast. For GitHub exploration, use
 * {@link createLoggedGitHubChatSession} instead.
 *
 * @param identity - Per-request {@link SessionIdentity}; the session acts
 *   as `identity.userId` using `identity.gitHubToken`.
 * @param operationName - Activity-log label. Defaults to `'Chat Session'`.
 * @param inputPrompt - Prompt snippet captured for log context only.
 * @param conversationId - Optional stable conversation key. When supplied,
 *   the underlying session is reused across turns and is **kept alive on
 *   wrapper `.destroy()`** so the next turn can resume; the conversation
 *   cache owns its eventual teardown. When omitted, the session is
 *   single-turn and is destroyed with the wrapper.
 * @returns A logging-wrapped session. Callers MUST always call `.destroy()`
 *   — it is a no-op for the underlying SDK session when `conversationId`
 *   is set, but still flushes per-turn logging state.
 * @throws When the Copilot SDK rejects `identity.gitHubToken` (401/403 or
 *   expired/invalid credential).
 */
export async function createLoggedChatSession(
  identity: SessionIdentity,
  operationName = 'Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await getConversationSession(
    identity.userId,
    conversationId,
    'chat:lightweight',
    {
      includeMcpTools: false,
      model: CHAT_MODEL,
      systemMessage: CHAT_SYSTEM_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  );
  return wrapSessionWithLogging(
    identity.userId,
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
 * Create a logged chat session **with** GitHub MCP tools enabled — for
 * users exploring repos, searching code, etc. Slower to create than
 * {@link createLoggedChatSession} because of MCP setup.
 *
 * @param identity - Per-request {@link SessionIdentity}. MCP tools call
 *   GitHub as `identity.userId` using `identity.gitHubToken`.
 * @param operationName - Activity-log label. Defaults to
 *   `'GitHub Chat Session'`.
 * @param inputPrompt - Prompt snippet captured for log context only.
 * @param conversationId - Optional stable conversation key. Same reuse /
 *   lifecycle semantics as {@link createLoggedChatSession}.
 * @returns A logging-wrapped session backed by MCP-enabled GitHub access.
 *   Callers MUST call `.destroy()` (no-op on the SDK session when
 *   `conversationId` is set; the conversation cache handles eventual
 *   teardown).
 * @throws When the Copilot SDK rejects `identity.gitHubToken` (401/403 or
 *   expired/invalid credential) or MCP server initialisation fails.
 */
export async function createLoggedGitHubChatSession(
  identity: SessionIdentity,
  operationName = 'GitHub Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const chatTools = getCopilotGithubMcpTools();
  const { session, metrics } = await getConversationSession(
    identity.userId,
    conversationId,
    'chat:mcp',
    {
      includeMcpTools: true,
      model: CHAT_MODEL,
      ...(chatTools && chatTools.length > 0 && { tools: chatTools }),
      systemMessage: GITHUB_CHAT_SYSTEM_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  );
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    CHAT_MODEL,
    undefined, // No pool replenishment
    metrics,
    !conversationId
  );
}
