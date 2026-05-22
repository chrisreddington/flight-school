/**
 * Copilot SDK Server Utilities
 *
 * This module provides authentic Copilot SDK usage:
 * - Creative AI generation (daily focus, coaching)
 * - Multi-turn conversations (chat)
 * - MCP tool access for GitHub exploration
 *
 * All SDK operations are automatically logged through logged session wrappers.
 *
 * For data fetching, use `@/lib/github` instead (direct Octokit).
 */

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
import { wrapSessionWithLogging } from './logged-session';
import { getCopilotGithubMcpTools } from './mcp-tools';
import type { SessionIdentity } from './session-identity';

export { createSessionIdentity, type SessionIdentity } from './session-identity';
export { wrapSessionWithLogging } from './logged-session';

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
