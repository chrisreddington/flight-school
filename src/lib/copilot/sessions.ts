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

import { getMcpServerConfig } from './mcp';
import {
  CopilotEntitlementRequiredError,
  hasNegativeEntitlement,
  isCopilotEntitlementError,
  markNegativeEntitlement,
} from './entitlement';
import type {
  SessionCreationMetrics,
  SessionOptions,
  SessionWithMetrics,
} from './types';
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

const log = logger.withTag('Copilot SDK');

// =============================================================================
// Model Configuration
// =============================================================================

/** Model tiers for different use cases */
export const MODEL_TIERS = {
  /** Standard model for chat and coaching */
  standard: 'gpt-5-mini',
  /** Faster model for low-latency chat */
  fastChat: 'claude-haiku-4.5',
} as const;

/** Override chat model for performance tuning */
export const CHAT_MODEL = process.env.COPILOT_CHAT_MODEL ?? MODEL_TIERS.fastChat;

export { getCopilotGithubMcpTools } from './mcp-tools';

const mcpOnlyPermissionHandler: PermissionHandler = (request) => {
  if (request.kind === 'mcp') {
    return { kind: 'approve-once' };
  }
  return { kind: 'reject', feedback: 'MCP tools only for this session.' };
};

// =============================================================================
// Singleton Client
// =============================================================================

let client: CopilotClient | null = null;

/**
 * Get the singleton Copilot client.
 */
async function getCopilotClient(): Promise<CopilotClient> {
  if (!client) {
    const otlpEndpoint =
      process.env.COPILOT_OTEL_ENDPOINT ??
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

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

// =============================================================================
// Client Warmup
// =============================================================================

// Track shutdown state in global to survive HMR
const globalForShutdown = globalThis as typeof globalThis & {
  __isShuttingDown?: boolean;
};

let isShuttingDown = globalForShutdown.__isShuttingDown ?? false;

// =============================================================================
// Conversation Session Caching
// =============================================================================

const CHAT_SESSION_TTL_MS = 10 * 60 * 1000;
const CHAT_SESSION_MAX = 20;

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

function pruneChatSessions(): void {
  const now = Date.now();
  for (const [key, entry] of chatSessionCache.entries()) {
    if (now - entry.lastUsed > CHAT_SESSION_TTL_MS) {
      log.debug('Chat session expired', { key, userId: entry.userId });
      entry.session.destroy().catch((err) => {
        log.warn('Session destroy warning', { err });
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
    entry.session.destroy().catch((err) => {
      log.warn('Session destroy warning', { err });
    });
    chatSessionCache.delete(key);
  }
}

// =============================================================================
// Session Factory
// =============================================================================

/**
 * Create a Copilot session with metrics tracking.
 *
 * @remarks
 * Multi-tenant invariant: `options.userId` and `options.gitHubToken` are
 * REQUIRED. If `userId` is falsy this function throws — the cache layer above
 * also keys on `userId`, and defaulting either field would risk session
 * reuse across GitHub identities.
 *
 * @param options - Session configuration (must include userId + gitHubToken)
 * @param poolKey - Identifier for metrics tracking
 * @returns Session and creation metrics
 * @throws {Error} if `options.userId` is missing/empty (multi-tenant invariant)
 * @throws {Error} if `options.gitHubToken` is missing/empty (multi-tenant invariant)
 */
export async function createSessionWithMetrics(
  options: SessionOptions,
  poolKey = 'unknown'
): Promise<SessionWithMetrics> {
  if (!options.userId) {
    throw new Error('userId required for session cache key — multi-tenant invariant');
  }
  if (!options.gitHubToken) {
    throw new Error('gitHubToken is required — multi-tenant invariant (no ambient auth)');
  }
  const model = options.model ?? MODEL_TIERS.standard;
  const includeMcp = options.includeMcpTools === true; // Default to false for speed
  const startTime = Date.now();

  return withSpan(
    `${GEN_AI_OPERATION.CREATE_AGENT} ${model}`,
    {
      [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CREATE_AGENT,
      [GEN_AI_REQUEST_MODEL]: model,
      [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
      'copilot.pool_key': poolKey,
      'copilot.mcp_enabled': includeMcp,
    },
    async () => {
      // P5: short-circuit for users already known to lack a Copilot license.
      // The negative verdict is sticky for NEGATIVE_TTL_MS (5 minutes) so we
      // don't ping the SDK every request for unentitled users.
      if (hasNegativeEntitlement(options.userId)) {
        recordAiOperation('createSession', Date.now() - startTime, model, 'error');
        throw new CopilotEntitlementRequiredError(
          'A GitHub Copilot subscription is required to use AI features.',
        );
      }

      try {
        const copilot = await getCopilotClient();
        let mcpConfig = null;
        if (includeMcp) {
          if (options.gitHubToken) {
            mcpConfig = getMcpServerConfig({
              token: options.gitHubToken,
              tools: options.tools,
            });
          } else {
            log.warn('No GitHub token supplied - MCP tools will be disabled');
          }
        }
        const permissionHandler = includeMcp ? mcpOnlyPermissionHandler : approveAll;

        const session = await copilot.createSession({
          model,
          streaming: true, // Enable streaming for delta events
          onPermissionRequest: permissionHandler,
          // Per-session GitHub identity (multitenancy). Independent of any
          // client-level token. Only set when the caller supplied one.
          ...(options.gitHubToken && { gitHubToken: options.gitHubToken }),
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
          ...(mcpConfig && {
            mcpServers: {
              github: mcpConfig,
            },
          }),
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
            mcpEnabled: Boolean(mcpConfig),
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
    }
  );
}

/**
 * Get or create a session for a conversation (with caching).
 *
 * @remarks
 * For new conversations, creates a fresh session and caches it. For existing
 * conversations, reuses the cached session (multi-turn).
 *
 * Multi-tenant invariant: the cache is keyed by `userId` so two GitHub
 * identities can never share a session entry even if they share a
 * `conversationId`. `userId` (caller-supplied) MUST match `options.userId`;
 * we throw if `userId` is missing/empty.
 *
 * @param userId - GitHub user ID. Required to isolate session caches per user.
 * @param conversationId - Optional conversation ID for session reuse
 * @param poolKey - Pool identifier (for logging/metrics)
 * @param options - Session configuration (must include matching userId + gitHubToken)
 * @returns Session and creation metrics
 * @throws {Error} if `userId` is missing/empty (multi-tenant invariant)
 * @throws {Error} if `options.gitHubToken` is missing/empty (multi-tenant invariant)
 */
export async function getConversationSession(
  userId: string,
  conversationId: string | undefined,
  poolKey: string,
  options: SessionOptions
): Promise<SessionWithMetrics> {
  if (!userId) {
    throw new Error('userId required for session cache key — multi-tenant invariant');
  }
  if (!options.gitHubToken) {
    throw new Error('gitHubToken is required — multi-tenant invariant (no ambient auth)');
  }
  if (!conversationId) {
    log.debug('No conversation ID - creating fresh session', { poolKey, userId });
    return createSessionWithMetrics({ ...options, userId }, poolKey);
  }

  pruneChatSessions();

  const cacheKey = `${userId}:${poolKey}:${conversationId}`;
  const cached = chatSessionCache.get(cacheKey);
  if (cached) {
    log.debug('Conversation HIT', { conversationId, poolKey, userId });
    cached.lastUsed = Date.now();
    return {
      session: cached.session,
      metrics: createReusedSessionMetrics(cached.metrics),
    };
  }

  log.debug('Conversation MISS - creating session', { conversationId, poolKey, userId });
  const { session, metrics } = await createSessionWithMetrics({ ...options, userId }, poolKey);
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
  
  // Destroy all sessions, suppressing errors
  await Promise.allSettled(
    sessions.map(async (session) => {
      try {
        await session.destroy();
      } catch {
        // Suppress stream errors during shutdown
      }
    })
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
