/**
 * Copilot SDK Session Factory
 *
 * Provides session caching and factory functions for
 * creating Copilot sessions efficiently. Includes support for:
 * - Conversation-based session caching for multi-turn chats
 * - Configurable MCP tool access
 *
 * @see getMcpServerConfig for MCP configuration
 */

import type { CopilotSession } from '@github/copilot-sdk';
import type { PermissionHandler } from '@github/copilot-sdk';
import { approveAll, CopilotClient } from '@github/copilot-sdk';
import { context, propagation } from '@opentelemetry/api';

import { buildMcpServersForCapabilities, mcpCapabilityIdsOf } from './capabilities';
import { composeCapabilityFingerprint } from './profiles';
import { rememberConversationCapabilities } from './conversation-capabilities';
import {
  CopilotEntitlementRequiredError,
  hasNegativeEntitlement,
  isCopilotEntitlementError,
  markNegativeEntitlement,
} from './entitlement';
import { logger } from '@/lib/logger';
import { recordAiOperation, withSpan } from '@/lib/observability/telemetry';
import {
  GEN_AI_OPERATION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_GITHUB_COPILOT,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
} from '@/lib/observability/semconv';
import { createNewSessionMetrics, createReusedSessionMetrics } from './session-metrics';
import { formatRequestedCapabilities } from './telemetry-attrs';
import type { SessionCreationMetrics, SessionOptions } from './types';

/**
 * Session with its creation metrics.
 *
 * @remarks Declared inline (rather than in `./types`) because the
 * `CopilotSession` reference must stay inside the worker-allowlisted file
 * boundary — `./types` is consumed from Web/API and may not import the
 * SDK, even at the type level.
 */
export interface SessionWithMetrics {
  session: CopilotSession;
  metrics: SessionCreationMetrics;
}

const log = logger.withTag('Copilot SDK');

// Model Configuration

/** Model tiers for different use cases */
const MODEL_TIERS = {
  /** Standard model for chat and coaching */
  standard: 'gpt-5-mini',
  /** Faster model for low-latency chat */
  fastChat: 'claude-haiku-4.5',
} as const;

/** Override chat model for performance tuning */
export const CHAT_MODEL = process.env.COPILOT_CHAT_MODEL ?? MODEL_TIERS.fastChat;

const mcpOnlyPermissionHandler: PermissionHandler = (request) => {
  if (request.kind === 'mcp') {
    return { kind: 'approve-once' };
  }
  return { kind: 'reject', feedback: 'MCP tools only for this session.' };
};

let client: CopilotClient | null = null;

/**
 * Get the singleton Copilot client.
 */
async function getCopilotClient(): Promise<CopilotClient> {
  if (!client) {
    const otlpEndpoint = process.env.COPILOT_OTEL_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    client = new CopilotClient({
      // Multitenant: never fall back to the host's ambient gh CLI identity.
      // GitHub tokens are supplied per-session via SessionOptions.gitHubToken.
      useLoggedInUser: false,
      ...(otlpEndpoint && {
        telemetry: {
          otlpEndpoint,
        },
      }),
      onGetTraceContext: () => {
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        return carrier;
      },
    });
  }
  return client;
}

// Track shutdown state in global to survive HMR
const globalForShutdown = globalThis as typeof globalThis & {
  __isShuttingDown?: boolean;
};

let isShuttingDown = globalForShutdown.__isShuttingDown ?? false;

const CHAT_SESSION_TTL_MS = 10 * 60 * 1000;
/**
 * Cache size bumped from 20 → 50 to absorb realistic concurrent-user load
 * (panel feedback: most smoke-test thread-1 invocations were cold MISSes).
 * Each entry holds a single SDK session; eviction is LRU.
 */
const CHAT_SESSION_MAX = 50;

interface CachedChatSession {
  session: CopilotSession;
  lastUsed: number;
  metrics: SessionCreationMetrics;
  /** GitHub user ID this session is bound to (for diagnostics + eviction logging). */
  userId: string;
}

// Store conversation cache in global to survive HMR in dev mode
const globalForConversationCache = globalThis as typeof globalThis & {
  __chatSessionCache?: Map<string, CachedChatSession>;
};

const chatSessionCache = globalForConversationCache.__chatSessionCache ?? new Map<string, CachedChatSession>();
if (!globalForConversationCache.__chatSessionCache) {
  globalForConversationCache.__chatSessionCache = chatSessionCache;
}

// Conversation-→-capability memory lives in `./conversation-capabilities`
// so the monotonic-across-turns guarantee can be unit-tested without
// pulling in the SDK-bound session pool. Re-exported from this module
// so existing call sites keep their import path.
export { getConversationCapabilities } from './conversation-capabilities';

function pruneChatSessions(): void {
  const now = Date.now();
  for (const [key, entry] of chatSessionCache.entries()) {
    if (now - entry.lastUsed > CHAT_SESSION_TTL_MS) {
      log.debug('Chat session expired', { key, userId: entry.userId });
      entry.session.disconnect().catch((err) => {
        log.warn('Session disconnect warning', { err });
      });
      chatSessionCache.delete(key);
    }
  }

  if (chatSessionCache.size <= CHAT_SESSION_MAX) {
    return;
  }

  const sorted = [...chatSessionCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  const overflow = sorted.slice(0, chatSessionCache.size - CHAT_SESSION_MAX);
  for (const [key, entry] of overflow) {
    log.debug('Chat session evicted (LRU)', { key, userId: entry.userId });
    entry.session.disconnect().catch((err) => {
      log.warn('Session disconnect warning', { err });
    });
    chatSessionCache.delete(key);
  }
}

/**
 * Create a Copilot session with metrics tracking.
 *
 * @remarks
 * Multi-tenant invariant: `options.userId` and `options.gitHubToken` are
 * REQUIRED. If `userId` is falsy this function throws — the cache layer above
 * also keys on `userId`, and defaulting either field would risk session
 * reuse across GitHub identities.
 *
 * The MCP servers map is built from `options.capabilities` (resolved by
 * the caller via `resolveProfile`); no inline branching on a boolean flag.
 *
 * @param options - Session configuration (must include userId, gitHubToken,
 *   profile, and resolved capabilities)
 * @returns Session and creation metrics
 * @throws {Error} if `options.userId` is missing/empty (multi-tenant invariant)
 * @throws {Error} if `options.gitHubToken` is missing/empty (multi-tenant invariant)
 */
export async function createSessionWithMetrics(options: SessionOptions): Promise<SessionWithMetrics> {
  if (!options.userId) {
    throw new Error('userId required for session cache key — multi-tenant invariant');
  }
  if (!options.gitHubToken) {
    throw new Error('gitHubToken is required — multi-tenant invariant (no ambient auth)');
  }
  const model = options.model ?? MODEL_TIERS.standard;
  const capabilities = options.capabilities;
  const capabilityFingerprint =
    options.capabilityFingerprint ?? composeCapabilityFingerprint(capabilities, options.systemMessage ?? '');
  const poolKey = `${options.profile}:${capabilityFingerprint}`;
  const mcpServerIds = mcpCapabilityIdsOf(capabilities);
  const sortedMcpServerIds = [...mcpServerIds].sort().join(',');
  const sortedCapabilityIds = [...capabilities]
    .map((selection) => selection.id)
    .sort()
    .join(',');
  const requestedCapabilitiesAttr = formatRequestedCapabilities(options.requestedCapabilities);
  const startTime = Date.now();

  return withSpan(
    `${GEN_AI_OPERATION.CREATE_AGENT} ${model}`,
    {
      [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CREATE_AGENT,
      [GEN_AI_REQUEST_MODEL]: model,
      [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
      'copilot.pool_key': poolKey,
      'copilot.profile': options.profile,
      'copilot.profile.elevated': options.wasAutoElevated === true,
      'copilot.profile.requested_capabilities': requestedCapabilitiesAttr,
      'copilot.capability.count': capabilities.length,
      'copilot.capability.ids': sortedCapabilityIds,
      'copilot.mcp.server_count': mcpServerIds.length,
      'copilot.mcp.servers': sortedMcpServerIds,
    },
    async () => {
      // P5: short-circuit for users already known to lack a Copilot license.
      // The negative verdict is sticky for NEGATIVE_TTL_MS (5 minutes) so we
      // don't ping the SDK every request for unentitled users.
      if (hasNegativeEntitlement(options.userId)) {
        recordAiOperation('createSession', Date.now() - startTime, model, 'error');
        throw new CopilotEntitlementRequiredError('A GitHub Copilot subscription is required to use AI features.');
      }

      try {
        const copilot = await getCopilotClient();
        const mcpServers = buildMcpServersForCapabilities(capabilities, (id) =>
          id === 'github' ? options.gitHubToken : undefined,
        );
        const hasMcpServers = Object.keys(mcpServers).length > 0;
        const permissionHandler = hasMcpServers ? mcpOnlyPermissionHandler : approveAll;

        const session = await copilot.createSession({
          model,
          streaming: true, // Enable streaming for delta events
          onPermissionRequest: permissionHandler,
          // Per-session GitHub identity (multitenancy). Independent of any
          // client-level token.
          gitHubToken: options.gitHubToken,
          // Disable built-in tools we don't need; prefer GitHub MCP tools for repo context
          excludedTools: [
            'shell',
            'editFile',
            'createFile',
            'deleteFile',
            'runCommand',
            'bash',
            'terminal',
            'web_fetch',
            'web_search',
            'task',
            'view',
            'glob',
            'rg',
            'grep',
            'read_bash',
            'write_bash',
            'list_bash',
            'stop_bash',
            'gh',
            'curl',
          ],
          ...(hasMcpServers && { mcpServers }),
          ...(options.systemMessage && {
            systemMessage: {
              mode: 'append',
              content: options.systemMessage,
            },
          }),
        });

        const sessionCreateMs = Date.now() - startTime;
        recordAiOperation('createSession', sessionCreateMs, model, 'ok');

        return {
          session,
          metrics: createNewSessionMetrics({
            poolKey,
            sessionCreateMs,
            mcpEnabled: hasMcpServers,
            model,
          }),
        };
      } catch (error) {
        recordAiOperation('createSession', Date.now() - startTime, model, 'error');
        // P5: detect entitlement failures from the SDK / underlying CLI
        // server and re-throw as a typed error the HTTP layer maps to 402.
        if (isCopilotEntitlementError(error)) {
          markNegativeEntitlement(options.userId);
          log.warn('Copilot entitlement check failed', {
            userId: options.userId,
            poolKey,
          });
          throw new CopilotEntitlementRequiredError(
            'A GitHub Copilot subscription is required to use AI features.',
            error,
          );
        }
        throw error;
      }
    },
  );
}

/**
 * Get or create a session for a conversation (with caching).
 *
 * @remarks
 * Cache key shape: `${userId}:${profileId}:${capabilityFingerprint}:${conversationId}`.
 * Two GitHub identities can never share an entry (userId partition); two
 * surfaces with different capability sets can never share an entry
 * (fingerprint partition).
 *
 * @param conversationId - Optional conversation ID for session reuse
 * @param options - Session configuration (profile + capabilities + identity)
 * @returns Session and creation metrics
 * @throws {Error} if `options.userId` is missing/empty (multi-tenant invariant)
 * @throws {Error} if `options.gitHubToken` is missing/empty (multi-tenant invariant)
 */
export async function getConversationSession(
  conversationId: string | undefined,
  options: SessionOptions,
): Promise<SessionWithMetrics> {
  if (!options.userId) {
    throw new Error('userId required for session cache key — multi-tenant invariant');
  }
  if (!options.gitHubToken) {
    throw new Error('gitHubToken is required — multi-tenant invariant (no ambient auth)');
  }
  const { userId, profile } = options;
  const capabilityFingerprint =
    options.capabilityFingerprint ?? composeCapabilityFingerprint(options.capabilities, options.systemMessage ?? '');
  const capabilityIds = options.capabilities.map((selection) => selection.id);

  if (!conversationId) {
    log.debug('No conversation ID - creating fresh session', { profile, userId });
    return createSessionWithMetrics({ ...options, capabilityFingerprint });
  }

  pruneChatSessions();

  const cacheKey = `${userId}:${profile}:${capabilityFingerprint}:${conversationId}`;
  const cached = chatSessionCache.get(cacheKey);
  if (cached) {
    log.debug('Conversation HIT', { conversationId, profile, userId });
    cached.lastUsed = Date.now();
    rememberConversationCapabilities(userId, conversationId, capabilityIds);
    return {
      session: cached.session,
      metrics: createReusedSessionMetrics(cached.metrics),
    };
  }

  log.debug('Conversation MISS - creating session', { conversationId, profile, userId });
  const { session, metrics } = await createSessionWithMetrics({
    ...options,
    capabilityFingerprint,
  });
  const cachedMetrics = {
    ...metrics,
    reusedConversation: false,
  };

  chatSessionCache.set(cacheKey, {
    session,
    lastUsed: Date.now(),
    metrics: cachedMetrics,
    userId,
  });
  rememberConversationCapabilities(userId, conversationId, capabilityIds);

  return { session, metrics: cachedMetrics };
}

/**
 * Gracefully shutdown all cached sessions.
 * Call this during server shutdown to avoid stream errors.
 */
export async function shutdownAllPools(): Promise<void> {
  if (isShuttingDown) return;

  isShuttingDown = true;
  globalForShutdown.__isShuttingDown = true;
  log.info('Shutting down...');

  const sessions: CopilotSession[] = [];

  // Clear conversation cache
  for (const entry of chatSessionCache.values()) {
    sessions.push(entry.session);
  }
  chatSessionCache.clear();

  // Disconnect all sessions, suppressing errors
  await Promise.allSettled(
    sessions.map(async (session) => {
      try {
        await session.disconnect();
      } catch {
        // Suppress stream errors during shutdown
      }
    }),
  );

  log.info('Cleaned up sessions', { count: sessions.length });
}

/**
 * Warm the Copilot client on startup.
 *
 * Session pooling doesn't work because SDK sessions retain conversation state.
 * However, warming the client ensures the first request doesn't pay auth/init cost.
 * Conversation caching handles multi-turn performance (reuses session within same thread).
 */
export async function warmCopilotClient(): Promise<void> {
  log.info('Warming client connection...');
  const startTime = Date.now();

  // Warm the singleton client (handles auth, establishes connection)
  await getCopilotClient();

  const duration = Date.now() - startTime;
  log.info('Client warmed', { durationMs: duration });
  log.info('Conversation caching active for multi-turn chat performance');
}
