/**
 * Copilot SDK Streaming Support
 *
 * Public factories for real-time chat/learning/evaluation responses. Each
 * factory selects a chat profile and delegates to
 * `createGenericStreamingSession`, which owns the SDK plumbing and telemetry.
 *
 * @see createChatStreamingSession for chat-class profiles (chat / learning)
 * @see createEvaluationStreamingSession for challenge evaluation
 */

import { resolveProfile, type ResolvedProfile } from './profiles';
import { type CapabilitiesArg } from './profile-types';
import { getConversationCapabilities } from './sessions';
import { createGenericStreamingSession } from './streaming-session';
import type { StreamingSession } from './types';

/** Chat-class profiles permitted on the streaming chat factory. */
type ChatStreamingProfile = 'chat' | 'learning';

interface ChatStreamingFactoryOptions {
  /** Which chat-class profile to use. */
  profile: ChatStreamingProfile;
  /** Caller-supplied capability selection (defaults to profile defaults). */
  capabilities?: CapabilitiesArg;
  /**
   * Pre-resolved profile from `resolveProfile()`. Pass this when the
   * caller has already resolved against the original prompt so we don't
   * re-evaluate `shouldElevate` heuristics against a worker-decorated
   * prompt (e.g. the per-turn capability context prefix prepended to the
   * user message). When supplied, `capabilities` is ignored.
   */
  resolved?: ResolvedProfile;
  /** Tag for activity logging / span attrs. */
  operationName?: string;
  /** Conversation id for session reuse. */
  conversationId?: string;
}

/** Default `operationName` per chat-class profile. */
const DEFAULT_OPERATION_NAMES: Record<ChatStreamingProfile, string> = {
  chat: 'Chat',
  learning: 'Learning Chat',
};

/** Per-profile log prefix used in the worker streaming logger. */
const LOG_PREFIXES: Record<ChatStreamingProfile, string> = {
  chat: 'Copilot Streaming',
  learning: 'Copilot Learning',
};

/**
 * Create a streaming session for a chat-class profile (`chat` or
 * `learning`). The profile picks the voice; capabilities are orthogonal.
 *
 * @param identity - per-request `{ userId, gitHubToken }` from `requireUserContext`
 * @param prompt - the user-facing prompt (may include a capability context prefix)
 * @param options - profile + (capabilities | resolved) + conversation overrides
 */
export async function createChatStreamingSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  options: ChatStreamingFactoryOptions,
): Promise<StreamingSession> {
  const { profile, capabilities, resolved: preResolved, operationName, conversationId } = options;
  if (preResolved && preResolved.profileId !== profile) {
    throw new Error(
      `createChatStreamingSession: pre-resolved profile '${preResolved.profileId}' ` +
        `does not match factory profile '${profile}' — caller bug`,
    );
  }
  const resolved = preResolved ?? resolveProfile(profile, {
    prompt,
    capabilities,
    conversationCapabilities: getConversationCapabilities(identity.userId, conversationId),
  });
  return createGenericStreamingSession({
    prompt,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    capabilityFingerprint: resolved.capabilityFingerprint,
    requestedCapabilities: resolved.requestedCapabilities,
    wasAutoElevated: resolved.wasAutoElevated,
    operationName: operationName ?? DEFAULT_OPERATION_NAMES[profile],
    conversationId,
    systemMessage: resolved.systemMessage,
    model: resolved.model,
    logPrefix: LOG_PREFIXES[profile],
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}

/**
 * Create a streaming evaluation session for challenge solutions. Each
 * evaluation is independent (no conversation reuse) and never needs
 * GitHub tools.
 *
 * The caller layers the evaluation-specific system prompt because the
 * `evaluation` profile has no base prompt — the surface owns the
 * entire instruction set.
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
  // Cache invariant: the caller-supplied `systemMessage` overrides
  // `resolved.systemMessage`, so the `capabilityFingerprint` (which
  // hashes `resolved.systemMessage`) does NOT reflect the effective
  // prompt. This is only safe because `conversationId` is hard-coded
  // to `undefined` here — every evaluation runs a fresh session and
  // never reuses a pooled one. If you ever expose a `conversationId`
  // option, you MUST fold a hash of the caller's `systemMessage` into
  // the pool key or two evaluations with different prompts will
  // silently share a session.
  return createGenericStreamingSession({
    prompt,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    capabilityFingerprint: resolved.capabilityFingerprint,
    requestedCapabilities: resolved.requestedCapabilities,
    wasAutoElevated: resolved.wasAutoElevated,
    operationName,
    conversationId: undefined,
    systemMessage,
    model: resolved.model,
    logPrefix: 'Copilot Evaluation',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}
