/**
 * Copilot SDK Streaming Support
 *
 * Provides streaming session factories for real-time chat responses.
 * Supports both regular chat and learning-focused sessions with
 * event-based streaming via async generators.
 *
 * @see createStreamingChatSession for basic chat streaming
 * @see createLearningStreamingSession for educational responses
 */

import { logger } from '@/lib/logger';
import { activityLogger } from './activity/logger';
import {
  CHAT_MODEL,
  getConversationSession,
  LEARNING_LENS_SYSTEM_PROMPT,
} from './sessions';
import type {
  StreamEvent,
  StreamingSession,
  StreamingToolCall
} from './types';

// =============================================================================
// Internal Types
// =============================================================================

/** Configuration for creating a streaming session */
interface StreamingSessionConfig {
  /** User's prompt */
  prompt: string;
  /** Whether to include MCP GitHub tools */
  useGitHubTools: boolean;
  /** Name for activity logging */
  operationName: string;
  /** Optional conversation ID for session reuse */
  conversationId?: string;
  /** System message for the session */
  systemMessage: string;
  /** Pool key prefix (e.g., 'chat' or 'learning') */
  poolKeyPrefix: string;
  /** Log prefix for console messages */
  logPrefix: string;
}

// =============================================================================
// Internal Implementation
// =============================================================================

/**
 * Generic streaming session factory.
 *
 * Creates a streaming session with the provided configuration.
 * This is the internal implementation that powers both chat and learning sessions.
 *
 * @internal
 */
async function createGenericStreamingSession(config: StreamingSessionConfig): Promise<StreamingSession> {
  const { prompt, useGitHubTools, operationName, conversationId, systemMessage, poolKeyPrefix, logPrefix } = config;
  const startTime = Date.now();
  
  const log = logger.withTag(logPrefix);
  
  const model = CHAT_MODEL;

  // Build pool key based on MCP usage
  const poolKey = useGitHubTools ? `${poolKeyPrefix}:mcp` : `${poolKeyPrefix}:lightweight`;

  // Create session with or without MCP tools
  const { session, metrics } = useGitHubTools
    ? await getConversationSession(conversationId, poolKey, {
        includeMcpTools: true,
        model,
        ...(process.env.COPILOT_GITHUB_MCP_TOOLS
          ? { tools: process.env.COPILOT_GITHUB_MCP_TOOLS.split(',').map((tool) => tool.trim()).filter(Boolean) }
          : {}),
        systemMessage,
      })
    : await getConversationSession(conversationId, poolKey, {
        includeMcpTools: false,
        model,
        systemMessage,
      });

  // Track tool calls
  const toolCalls: StreamingToolCall[] = [];
  let totalContent = '';

  // Start activity logging
  const complete = activityLogger.startOperation('ask', operationName, {
    prompt: prompt.slice(0, 100),
    model,
    sessionMetrics: metrics ? {
      poolHit: !metrics.createdNew,
      sessionCreateMs: metrics.sessionCreateMs,
      mcpEnabled: metrics.mcpEnabled,
      conversationReused: metrics.reusedConversation,
    } : undefined,
    // Server-side metrics (will be updated with client metrics later)
    serverMetrics: {
      firstTokenMs: null, // Will be set when first delta arrives
      totalMs: 0, // Will be set when stream completes
    },
  });

  // Capture the activity event ID so we can return it to the client
  // The client will use this to update the event with client-side metrics
  const activityEvents = activityLogger.getEvents();
  const activityEventId = activityEvents[activityEvents.length - 1]?.id;

  // Create async generator for streaming events
  const streamingMetrics = {
    firstDeltaMs: null as number | null,
    activityEventId, // Pass this to the client
  };

  async function* generateStream(): AsyncGenerator<StreamEvent, void, unknown> {
    let resolveIdle: (() => void) | null = null;
    let rejectWithError: ((err: Error) => void) | null = null;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    // Queue for delta events
    const eventQueue: StreamEvent[] = [];
    let queueResolver: (() => void) | null = null;

    // Set up event listener
    const unsubscribe = session.on((event) => {
      const eventType = event.type;

      if (eventType === 'assistant.message_delta') {
        const data = event.data as { deltaContent?: string };
        if (data.deltaContent) {
          if (streamingMetrics.firstDeltaMs === null) {
            streamingMetrics.firstDeltaMs = Date.now() - startTime;
          }
          totalContent += data.deltaContent;
          eventQueue.push({ type: 'delta', content: data.deltaContent });
          queueResolver?.();
        }
      } else if (eventType === 'tool.execution_start') {
        const data = event.data as { toolName: string; arguments: unknown };
        log.debug(`Tool start: ${data.toolName}`);
        toolCalls.push({
          name: data.toolName,
          args: data.arguments,
          result: '',
          startTime: Date.now(),
        });
        eventQueue.push({ type: 'tool_start', name: data.toolName, args: data.arguments });
        queueResolver?.();

        // Log to activity logger
        activityLogger.logEvent('tool', `mcp.${data.toolName}`, {
          metadata: { args: data.arguments },
        });
      } else if (eventType === 'tool.execution_complete') {
        const lastCall = toolCalls[toolCalls.length - 1];
        const data = event.data as { result?: unknown };
        if (lastCall) {
          lastCall.result = String(data.result || '').slice(0, 500);
          lastCall.endTime = Date.now();
          const duration = lastCall.endTime - lastCall.startTime;
          log.debug(`Tool complete: ${lastCall.name} (${duration}ms)`);
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
        const data = event.data as { message?: string };
        rejectWithError?.(new Error(data.message || 'Session error'));
      }
    });

    try {
      // Send the message (non-blocking)
      await session.send({ prompt });

      // Yield events as they arrive
      while (true) {
        // Wait for events or idle
        const hasEvents = eventQueue.length > 0;

        if (hasEvents) {
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!;
          }
        }

        // Check if we're done
        const raceResult = await Promise.race([
          idlePromise.then(() => 'idle' as const),
          new Promise<'more'>((resolve) => {
            queueResolver = () => resolve('more');
            // Timeout to check periodically
            setTimeout(() => resolve('more'), 20);
          }),
        ]);

        if (raceResult === 'idle') {
          // Yield any remaining events
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!;
          }
          break;
        }
      }

      // Success - complete logging with server-side metrics
      const durationMs = Date.now() - startTime;
      complete({
        text: totalContent.slice(0, 100),
        fullResponse: totalContent,
        toolsUsed: toolCalls.map((t) => t.name),
        metadata: { 
          toolsUsed: toolCalls.map((t) => t.name),
          firstTokenMs: streamingMetrics.firstDeltaMs,
        },
      });
      
      // Update server metrics in the event input
      if (activityEventId) {
        const events = activityLogger['getEvents']();
        const event = events.find(e => e.id === activityEventId);
        if (event && event.input?.serverMetrics) {
          event.input.serverMetrics.firstTokenMs = streamingMetrics.firstDeltaMs;
          event.input.serverMetrics.totalMs = durationMs;
        }
      }

      // Yield final done event
      yield {
        type: 'done',
        totalContent,
        toolCalls,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      complete(undefined, errorMessage);
      yield { type: 'error', message: errorMessage };
    } finally {
      unsubscribe();
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

// =============================================================================
// Public Session Factories
// =============================================================================

/**
 * Create a streaming chat session that yields events as they arrive.
 *
 * This is the most performant option for chat - responses stream to the
 * client as they're generated rather than waiting for completion.
 *
 * @param prompt - The user's message
 * @param useGitHubTools - Whether to include MCP GitHub tools
 * @param operationName - Name for activity logging
 * @param conversationId - Optional conversation ID for session reuse
 * @returns StreamingSession with async iterator
 *
 * @example
 * ```typescript
 * const { stream, cleanup } = await createStreamingChatSession("hello", false);
 * for await (const event of stream) {
 *   if (event.type === 'delta') process.stdout.write(event.content);
 *   if (event.type === 'done') console.log('\nComplete!');
 * }
 * cleanup();
 * ```
 */
export async function createStreamingChatSession(
  prompt: string,
  useGitHubTools: boolean,
  operationName = 'Chat',
  conversationId?: string
): Promise<StreamingSession> {
  const systemMessage = useGitHubTools
    ? `You are a helpful developer assistant with access to GitHub tools.
Be conversational, helpful, and concise. Reference specific repos when relevant.`
    : `You are a helpful developer assistant.

Be conversational, helpful, and concise. Mention GitHub tools only when asked.`;

  return createGenericStreamingSession({
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage,
    poolKeyPrefix: 'chat',
    logPrefix: 'Copilot Streaming',
  });
}

/**
 * Create a learning-focused streaming chat session.
 *
 * Uses the LEARNING_LENS_SYSTEM_PROMPT to provide responses that:
 * - Explain reasoning step-by-step
 * - Suggest follow-up questions and experiments
 * - Connect to user's context when relevant
 *
 * This is the streaming equivalent of createLearningChatSession.
 *
 * @param prompt - The user's message
 * @param useGitHubTools - Whether to include MCP GitHub tools
 * @param operationName - Name for activity logging
 * @param conversationId - Optional conversation ID for session reuse
 * @returns StreamingSession with async iterator
 *
 * @see SPEC-001 for learning chat requirements (AC3.1, AC3.2)
 */
export async function createLearningStreamingSession(
  prompt: string,
  useGitHubTools: boolean,
  operationName = 'Learning Chat',
  conversationId?: string
): Promise<StreamingSession> {
  return createGenericStreamingSession({
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage: LEARNING_LENS_SYSTEM_PROMPT,
    poolKeyPrefix: 'learning',
    logPrefix: 'Copilot Learning',
  });
}

/**
 * Create a streaming evaluation session for challenge solutions.
 *
 * Uses a custom system prompt for code evaluation with structured feedback.
 * This ensures proper separation between system instructions and user content
 * for accurate activity logging.
 *
 * @param prompt - The evaluation prompt (challenge + user code)
 * @param systemMessage - The evaluation system prompt
 * @param operationName - Name for activity logging (default: 'Challenge Evaluation')
 * @returns StreamingSession with async iterator
 *
 * @see SPEC-002 for challenge evaluation requirements
 */
export async function createEvaluationStreamingSession(
  prompt: string,
  systemMessage: string,
  operationName = 'Challenge Evaluation'
): Promise<StreamingSession> {
  return createGenericStreamingSession({
    prompt,
    useGitHubTools: false, // Evaluation doesn't need GitHub tools
    operationName,
    conversationId: undefined, // Each evaluation is independent
    systemMessage,
    poolKeyPrefix: 'evaluation',
    logPrefix: 'Copilot Evaluation',
  });
}
