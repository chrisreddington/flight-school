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
import { CopilotClient } from '@github/copilot-sdk';

import { getMcpServerConfig } from './mcp';
import type {
  SessionCreationMetrics,
  SessionOptions,
  SessionWithMetrics,
} from './types';
import { logger } from '@/lib/logger';

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

// =============================================================================
// Singleton Client
// =============================================================================

let client: CopilotClient | null = null;

/**
 * Get the singleton Copilot client.
 */
async function getCopilotClient(): Promise<CopilotClient> {
  if (!client) {
    client = new CopilotClient();
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
 * @param options - Session configuration
 * @param poolKey - Identifier for metrics tracking
 * @returns Session and creation metrics
 */
export async function createSessionWithMetrics(
  options?: SessionOptions,
  poolKey = 'unknown'
): Promise<SessionWithMetrics> {
  const startTime = Date.now();
  const copilot = await getCopilotClient();
  const includeMcp = options?.includeMcpTools === true; // Default to false for speed
  const mcpConfig = includeMcp ? await getMcpServerConfig(options?.tools) : null;
  const model = options?.model ?? MODEL_TIERS.standard;

  const session = await copilot.createSession({
    model,
    streaming: true, // Enable streaming for delta events
    ...(mcpConfig && {
      mcpServers: {
        github: mcpConfig,
      },
    }),
    ...(options?.systemMessage && {
      systemMessage: {
        mode: 'append',
        content: options.systemMessage,
      },
    }),
  });

  return {
    session,
    metrics: {
      poolKey,
      createdNew: true,
      sessionCreateMs: Date.now() - startTime,
      mcpEnabled: Boolean(mcpConfig),
      model,
      reusedConversation: false,
    },
  };
}

/**
 * Get or create a session for a conversation (with caching).
 *
 * For new conversations, creates a fresh session and caches it.
 * For existing conversations, reuses the cached session (multi-turn).
 *
 * @param conversationId - Optional conversation ID for session reuse
 * @param poolKey - Pool identifier (for logging/metrics)
 * @param options - Session configuration
 * @returns Session and creation metrics
 */
export async function getConversationSession(
  conversationId: string | undefined,
  poolKey: string,
  options: SessionOptions
): Promise<SessionWithMetrics> {
  if (!conversationId) {
    log.debug('No conversation ID - creating fresh session', { poolKey });
    return createSessionWithMetrics(options, poolKey);
  }

  pruneChatSessions();

  const cacheKey = `${poolKey}:${conversationId}`;
  const cached = chatSessionCache.get(cacheKey);
  if (cached) {
    log.debug('Conversation HIT', { conversationId, poolKey });
    cached.lastUsed = Date.now();
    return {
      session: cached.session,
      metrics: {
        ...cached.metrics,
        createdNew: false,
        sessionCreateMs: 0,
        reusedConversation: true,
      },
    };
  }

  log.debug('Conversation MISS - creating session', { conversationId, poolKey });
  const { session, metrics } = await createSessionWithMetrics(options, poolKey);
  const cachedMetrics = {
    ...metrics,
    reusedConversation: false,
  };

  chatSessionCache.set(cacheKey, {
    session,
    lastUsed: Date.now(),
    metrics: cachedMetrics,
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

// =============================================================================
// Learning-Focused Sessions (S3)
// =============================================================================

/**
 * Learning lens system prompt for educational chat sessions.
 *
 * Implements the learning-focused response pattern from copilot-instructions.md:
 * - Explains reasoning step-by-step
 * - Suggests follow-up questions and experiments
 * - Connects concepts to user's repositories when relevant
 * - Builds understanding rather than just providing solutions
 *
 * @see SPEC-001 AC3.1, AC3.2
 */
export const LEARNING_LENS_SYSTEM_PROMPT = `You are a developer learning companion.

When responding:
1. Explain your reasoning step-by-step
2. Suggest 2-3 follow-up questions or experiments
3. Reference the user's code when relevant
4. Be conversational but focused

If user wants a quick answer, skip the explanations.`;

