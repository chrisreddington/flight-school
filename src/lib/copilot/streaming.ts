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
import {
  recordAiOperation,
  recordAiStreamMetrics,
  recordAiTokenUsage,
} from '@/lib/observability/telemetry';
import {
  GEN_AI_OPERATION,
  GEN_AI_OPERATION_NAME,
  GEN_AI_PROVIDER_GITHUB_COPILOT,
  GEN_AI_PROVIDER_NAME,
  GEN_AI_REQUEST_MODEL,
  INSTRUMENTATION_SCOPE_SERVER,
  INSTRUMENTATION_SCOPE_VERSION,
} from '@/lib/observability/semconv';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { activityLogger } from './activity/logger';
import {
  CHAT_MODEL,
  getCopilotGithubMcpTools,
  getConversationSession,
} from './sessions';
import type {
  StreamEvent,
  StreamingSession,
  StreamingToolCall
} from './types';

// =============================================================================
// Internal Types
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
const LEARNING_LENS_SYSTEM_PROMPT = `You are a developer learning companion.

When responding:
1. Explain your reasoning step-by-step
2. Suggest 2-3 follow-up questions or experiments
3. Reference the user's code when relevant
4. Be conversational but focused

If user wants a quick answer, skip the explanations.`;

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
  /** GitHub user ID (partitions session cache per-identity) */
  userId: string;
  /** Per-session GitHub token forwarded to the SDK */
  gitHubToken: string;
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
  const { prompt, useGitHubTools, operationName, conversationId, systemMessage, poolKeyPrefix, logPrefix, userId, gitHubToken } = config;
  const startTime = Date.now();
  
  const log = logger.withTag(logPrefix);
  
  const model = CHAT_MODEL;

  // Build pool key based on MCP usage
  const poolKey = useGitHubTools ? `${poolKeyPrefix}:mcp` : `${poolKeyPrefix}:lightweight`;

  // Create session with or without MCP tools
  const githubMcpTools = getCopilotGithubMcpTools();
  const { session, metrics } = useGitHubTools
    ? await getConversationSession(userId, conversationId, poolKey, {
        includeMcpTools: true,
        model,
        ...(githubMcpTools.length > 0
          ? { tools: githubMcpTools }
          : {}),
        systemMessage,
        userId,
        gitHubToken,
      })
    : await getConversationSession(userId, conversationId, poolKey, {
        includeMcpTools: false,
        model,
        systemMessage,
        userId,
        gitHubToken,
      });

  // Track tool calls
  const toolCalls: StreamingToolCall[] = [];
  let totalContent = '';

  // Start activity logging
  const { eventId: activityEventId, complete } = await activityLogger.startOperation(
    userId,
    'ask',
    operationName,
    {
      prompt: prompt.slice(0, 100),
      model,
      sessionMetrics: metrics ? {
        poolHit: !metrics.createdNew,
        sessionCreateMs: metrics.sessionCreateMs,
        mcpEnabled: metrics.mcpEnabled,
        conversationReused: metrics.reusedConversation,
      } : undefined,
      // Server-side metrics (will be updated when stream completes)
      serverMetrics: {
        firstTokenMs: null,
        totalMs: 0,
      },
    },
  );

  // Create async generator for streaming events
  const streamingMetrics = {
    firstDeltaMs: null as number | null,
    activityEventId: activityEventId ?? undefined,
  };
  const tracer = trace.getTracer(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION);

  async function* generateStream(): AsyncGenerator<StreamEvent, void, unknown> {
    const streamSpan = tracer.startSpan(`${GEN_AI_OPERATION.CHAT} ${model}`, {
      attributes: {
        [GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION.CHAT,
        [GEN_AI_REQUEST_MODEL]: model,
        [GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_GITHUB_COPILOT,
        'app.operation': operationName,
        'ai.mcp_enabled': useGitHubTools,
      },
    });
    streamSpan.addEvent('stream.started');

    let resolveIdle: (() => void) | null = null;
    let rejectWithError: ((err: Error) => void) | null = null;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    // Queue for delta events
    const eventQueue: StreamEvent[] = [];
    let queueResolver: (() => void) | null = null;
    let deltaCount = 0;
    let deltaBytes = 0;
    const usageTotals = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };

    // Set up event listener
    const unsubscribe = session.on((event) => {
      const eventType = event.type;

      if (eventType === 'assistant.message_delta') {
        const deltaPayload = event.data as { deltaContent?: string };
        if (deltaPayload.deltaContent) {
          if (streamingMetrics.firstDeltaMs === null) {
            streamingMetrics.firstDeltaMs = Date.now() - startTime;
            streamSpan.addEvent('first_token', {
              'ai.stream.first_delta_ms': streamingMetrics.firstDeltaMs,
            });
          }
          deltaCount += 1;
          deltaBytes += Buffer.byteLength(deltaPayload.deltaContent);
          totalContent += deltaPayload.deltaContent;
          eventQueue.push({ type: 'delta', content: deltaPayload.deltaContent });
          queueResolver?.();
        }
      } else if (eventType === 'assistant.usage') {
        // Accumulate token counts; recorded once on stream completion so the
        // histogram sample reflects the whole turn rather than per-chunk noise.
        const usagePayload = event.data as {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
        usageTotals.inputTokens += usagePayload.inputTokens ?? 0;
        usageTotals.outputTokens += usagePayload.outputTokens ?? 0;
        usageTotals.cacheReadTokens += usagePayload.cacheReadTokens ?? 0;
        usageTotals.cacheWriteTokens += usagePayload.cacheWriteTokens ?? 0;
      } else if (eventType === 'tool.execution_start') {
        const toolStart = event.data as { toolName: string; arguments: unknown };
        log.debug(`Tool start: ${toolStart.toolName}`);
        streamSpan.addEvent('tool.start', {
          'tool.name': toolStart.toolName,
        });
        toolCalls.push({
          name: toolStart.toolName,
          args: toolStart.arguments,
          result: '',
          startTime: Date.now(),
        });
        eventQueue.push({ type: 'tool_start', name: toolStart.toolName, args: toolStart.arguments });
        queueResolver?.();

        // Log to activity logger
        activityLogger.logEvent(userId, 'tool', `mcp.${toolStart.toolName}`, {
          metadata: { args: toolStart.arguments },
        });
      } else if (eventType === 'tool.execution_complete') {
        const lastCall = toolCalls[toolCalls.length - 1];
        const toolComplete = event.data as { result?: unknown };
        if (lastCall) {
          lastCall.result = String(toolComplete.result || '').slice(0, 500);
          lastCall.endTime = Date.now();
          const duration = lastCall.endTime - lastCall.startTime;
          log.debug(`Tool complete: ${lastCall.name} (${duration}ms)`);
          streamSpan.addEvent('tool.complete', {
            'tool.name': lastCall.name,
            'tool.duration_ms': duration,
          });
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
        const errorPayload = event.data as { message?: string };
        rejectWithError?.(new Error(errorPayload.message || 'Session error'));
      }
    });

    try {
      // Send the message (non-blocking)
      const activeContext = trace.setSpan(context.active(), streamSpan);
      await context.with(activeContext, async () => {
        await session.send({ prompt });
      });

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
      complete(
        {
          text: totalContent.slice(0, 100),
          fullResponse: totalContent,
          toolsUsed: toolCalls.map((t) => t.name),
          metadata: {
            toolsUsed: toolCalls.map((t) => t.name),
            firstTokenMs: streamingMetrics.firstDeltaMs,
          },
        },
        undefined,
        {
          firstTokenMs: streamingMetrics.firstDeltaMs,
          totalMs: durationMs,
        },
      );

      recordAiStreamMetrics({
        model,
        mcpEnabled: useGitHubTools,
        poolHit: metrics ? !metrics.createdNew : null,
        firstTokenMs: streamingMetrics.firstDeltaMs,
        durationMs,
        deltaCount,
        deltaBytes,
        toolCalls: toolCalls.length,
        terminalState: 'completed',
      });
      recordAiOperation('streamSession', durationMs, model, 'ok');
      recordAiTokenUsage({
        operation: GEN_AI_OPERATION.CHAT,
        model,
        inputTokens: usageTotals.inputTokens,
        outputTokens: usageTotals.outputTokens,
        cacheReadTokens: usageTotals.cacheReadTokens,
        cacheWriteTokens: usageTotals.cacheWriteTokens,
      });
      streamSpan.addEvent('stream.completed', {
        'ai.stream.delta_count': deltaCount,
        'ai.stream.delta_bytes': deltaBytes,
        'ai.stream.tool_calls': toolCalls.length,
      });
      streamSpan.setStatus({ code: SpanStatusCode.OK });

      // Yield final done event
      yield {
        type: 'done',
        totalContent,
        toolCalls,
        durationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const durationMs = Date.now() - startTime;
      recordAiOperation('streamSession', durationMs, model, 'error');
      recordAiStreamMetrics({
        model,
        mcpEnabled: useGitHubTools,
        poolHit: metrics ? !metrics.createdNew : null,
        firstTokenMs: streamingMetrics.firstDeltaMs,
        durationMs,
        deltaCount,
        deltaBytes,
        toolCalls: toolCalls.length,
        terminalState: 'error',
      });
      streamSpan.addEvent('stream.failed', {
        message: errorMessage,
      });
      if (error instanceof Error) {
        streamSpan.recordException(error);
      }
      streamSpan.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
      complete(undefined, errorMessage);
      yield { type: 'error', message: errorMessage };
    } finally {
      unsubscribe();
      streamSpan.end();
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
  identity: { userId: string; gitHubToken: string },
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
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
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
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  useGitHubTools: boolean,
  operationName = 'Learning Chat',
  conversationId?: string
): Promise<StreamingSession> {
  // When GitHub tools are available, extend the system prompt to instruct the AI to use them
  const systemMessage = useGitHubTools
    ? `${LEARNING_LENS_SYSTEM_PROMPT}

You have access to GitHub MCP tools. When the user asks about repositories, use those tools to explore them — search code, read files, and get repo details.
Never use local shell/filesystem/web tools for repository questions.
Always use GitHub tools to look up real information rather than guessing.`
    : LEARNING_LENS_SYSTEM_PROMPT;

  return createGenericStreamingSession({
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage,
    poolKeyPrefix: 'learning',
    logPrefix: 'Copilot Learning',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
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
  identity: { userId: string; gitHubToken: string },
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
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}
