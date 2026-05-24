/**
 * Copilot SDK Streaming Support
 *
 * Public factories for real-time chat/learning/evaluation responses. Each
 * factory selects a chat profile and delegates to
 * `createGenericStreamingSession`, which owns the SDK plumbing and telemetry.
 *
 * @see createStreamingChatSession for basic chat streaming
 * @see createLearningStreamingSession for educational responses
 * @see createEvaluationStreamingSession for challenge evaluation
 */

import { resolveProfile, type ChatProfileId } from './profiles';
import { createGenericStreamingSession } from './streaming-session';
import type { StreamingSession } from './types';

/**
 * Create a streaming chat session that yields events as they arrive.
 *
 * @param identity - per-request `{ userId, gitHubToken }` from `requireUserContext`
 * @param prompt - The user's message
 * @param profile - Chat profile id (`'chat'` or `'chat-github'`)
 * @param operationName - Name for activity logging
 * @param conversationId - Optional conversation ID for session reuse
 *
 * @example
 * ```typescript
 * const { stream, cleanup } = await createStreamingChatSession(identity, "hello", 'chat');
 * for await (const event of stream) {
 *   if (event.type === 'delta') process.stdout.write(event.content);
 *   if (event.type === 'done') break;
 * }
 * cleanup();
 * ```
 */
export async function createStreamingChatSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  profile: ChatProfileId,
  operationName = 'Chat',
  conversationId?: string,
): Promise<StreamingSession> {
  const resolved = resolveProfile(profile, { prompt });
  return createGenericStreamingSession({
    prompt,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    operationName,
    conversationId,
    systemMessage: resolved.systemMessage,
    model: resolved.model,
    logPrefix: 'Copilot Streaming',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}

/**
 * Create a learning-focused streaming chat session. Uses the
 * `learning` / `learning-github` profile so responses explain reasoning,
 * suggest follow-ups, and connect to the user's context.
 *
 * @see SPEC-001 for learning chat requirements (AC3.1, AC3.2)
 */
export async function createLearningStreamingSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  profile: ChatProfileId,
  operationName = 'Learning Chat',
  conversationId?: string,
): Promise<StreamingSession> {
  const resolved = resolveProfile(profile, { prompt });
  return createGenericStreamingSession({
    prompt,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    operationName,
    conversationId,
    systemMessage: resolved.systemMessage,
    model: resolved.model,
    logPrefix: 'Copilot Learning',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}

/**
 * Create a streaming evaluation session for challenge solutions. Each
 * evaluation is independent (no conversation reuse) and never needs GitHub
 * tools.
 *
 * The caller layers the evaluation-specific system prompt because the
 * `evaluation` profile has no base prompt — the surface owns the entire
 * instruction set.
 *
 * @see SPEC-002 for challenge evaluation requirements
 */
export async function createEvaluationStreamingSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  systemMessage: string,
  operationName = 'Challenge Evaluation',
): Promise<StreamingSession> {
  const resolved = resolveProfile('evaluation');
  return createGenericStreamingSession({
    prompt,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    operationName,
    conversationId: undefined,
    systemMessage,
    model: resolved.model,
    logPrefix: 'Copilot Evaluation',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}
