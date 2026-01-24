/**
 * Challenge Authoring Session
 *
 * Creates streaming sessions for the challenge authoring conversation.
 * Uses the Copilot SDK for multi-turn conversation with specialized prompts.
 *
 * @see SPEC-006 for custom challenge authoring requirements
 */

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';
import { activityLogger } from '@/lib/copilot/activity/logger';
import {
  CHAT_MODEL,
  getConversationSession,
} from '@/lib/copilot/sessions';
import type {
  AuthoringSessionConfig,
  AuthoringStreamEvent,
  AuthoringStreamingSession,
} from '@/lib/challenge/authoring/types';

const log = logger.withTag('Authoring Session');

// =============================================================================
// System Prompts
// =============================================================================

/**
 * System prompt for the challenge authoring conversation.
 *
 * Guides the AI through a multi-turn conversation to help users
 * create well-defined coding challenges.
 */
const AUTHORING_SYSTEM_PROMPT = `You are a coding challenge author assistant helping me create a custom challenge for myself.

Your role is to:
1. Understand what kind of challenge I want to create
2. Ask clarifying questions to gather my requirements
3. Generate a well-structured challenge definition for me

## Conversation Flow

### Phase 1: Clarification (2-3 turns)
Ask me targeted questions about:
- Programming language (if not specified)
- Difficulty level (beginner, intermediate, advanced)
- What I want to learn or practice
- How much time I want to spend

Keep questions concise. One topic per message. Address me directly using "you".

### Phase 2: Generation
When you have enough information, generate a challenge in this EXACT JSON format:

\`\`\`json
{
  "title": "Challenge Title",
  "description": "Detailed description of what to build. Include requirements, expected inputs/outputs, and constraints.",
  "difficulty": "beginner" | "intermediate" | "advanced",
  "language": "typescript" | "python" | "javascript" | etc,
  "estimatedTime": "15 minutes" | "30 minutes" | "1 hour",
  "whyThisChallenge": ["Reason 1 this challenge is valuable for you", "Reason 2"]
}
\`\`\`

## Guidelines
- Be conversational but efficient - talk directly to me
- Don't repeat information I've already provided
- If I provide a template or example, work from that
- Generate challenges that are testable and well-scoped
- Always include the JSON block when generating the final challenge
- IMPORTANT: Only generate the JSON when I explicitly ask you to create/generate the challenge, or when I confirm I'm ready

## Context Handling
If I provide context about language, difficulty, or template preferences, use that information directly instead of asking.`;

/**
 * System prompt for challenge validation.
 */
const VALIDATION_SYSTEM_PROMPT = `You are validating a coding challenge definition.

Check for:
1. Clear, unambiguous requirements
2. Appropriate difficulty for the stated level
3. Reasonable time estimate
4. Testable success criteria
5. No missing information

Respond with a JSON object:
\`\`\`json
{
  "isValid": true | false,
  "issues": ["Issue 1", "Issue 2"] // empty if valid
}
\`\`\``;

// =============================================================================
// Session Factory
// =============================================================================

/**
 * Build the prompt for the authoring session.
 */
function buildAuthoringPrompt(config: AuthoringSessionConfig): string {
  const { prompt, context, action } = config;

  let enhancedPrompt = prompt;

  // Add context information if provided
  if (context) {
    const contextParts: string[] = [];

    if (context.language) {
      contextParts.push(`Language: ${context.language}`);
    }
    if (context.difficulty) {
      contextParts.push(`Difficulty: ${context.difficulty}`);
    }
    if (context.template) {
      contextParts.push(`Template: ${context.template}`);
    }
    if (context.focusSkills && context.focusSkills.length > 0) {
      contextParts.push(`Focus skills: ${context.focusSkills.join(', ')}`);
    }

    if (contextParts.length > 0) {
      enhancedPrompt = `[Context: ${contextParts.join('; ')}]\n\n${prompt}`;
    }
  }

  // Add action hint if specified
  if (action === 'generate') {
    enhancedPrompt += '\n\nPlease generate the challenge now based on our discussion.';
  } else if (action === 'validate') {
    enhancedPrompt = `Please validate this challenge definition:\n\n${prompt}`;
  }

  return enhancedPrompt;
}

/**
 * Creates a streaming session for challenge authoring.
 *
 * @param config - Authoring session configuration
 * @returns Streaming session with async iterator
 */
export async function createGenericStreamingSession(
  config: AuthoringSessionConfig
): Promise<AuthoringStreamingSession> {
  const { prompt, conversationId, action } = config;
  const startTime = nowMs();

  const model = CHAT_MODEL;
  const isValidation = action === 'validate';
  const systemMessage = isValidation ? VALIDATION_SYSTEM_PROMPT : AUTHORING_SYSTEM_PROMPT;
  const poolKey = isValidation ? 'authoring:validate' : 'authoring:conversation';

  // Generate new conversation ID if not provided
  const newConversationId = conversationId || `author-${nowMs()}-${Math.random().toString(36).substring(7)}`;

  // Build enhanced prompt with context
  const enhancedPrompt = buildAuthoringPrompt(config);

  // Get or create session (reuses session for same conversation)
  const { session, metrics } = await getConversationSession(
    conversationId,
    poolKey,
    {
      includeMcpTools: false, // Authoring doesn't need GitHub tools
      model,
      systemMessage,
    }
  );

  log.info(`Session ready: ${metrics.createdNew ? 'new' : 'reused'} (${metrics.sessionCreateMs}ms)`);

  // Track streaming metrics
  const streamingMetrics = {
    firstDeltaMs: null as number | null,
    activityEventId: undefined as string | undefined,
  };

  // Start activity logging
  const complete = activityLogger.startOperation('ask', 'Challenge Authoring', {
    prompt: prompt.slice(0, 100),
    model,
    sessionMetrics: {
      poolHit: !metrics.createdNew,
      sessionCreateMs: metrics.sessionCreateMs,
      mcpEnabled: false,
      conversationReused: metrics.reusedConversation,
    },
  });

  // Capture activity event ID
  const activityEvents = activityLogger.getEvents();
  streamingMetrics.activityEventId = activityEvents[activityEvents.length - 1]?.id;

  // Track content
  let totalContent = '';
  const toolCalls: unknown[] = [];

  async function* generateStream(): AsyncGenerator<AuthoringStreamEvent, void, unknown> {
    let resolveIdle: (() => void) | null = null;
    let rejectWithError: ((err: Error) => void) | null = null;
    const idlePromise = new Promise<void>((resolve, reject) => {
      resolveIdle = resolve;
      rejectWithError = reject;
    });

    // Event queue
    const eventQueue: AuthoringStreamEvent[] = [];
    let queueResolver: (() => void) | null = null;

    // Set up event listener
    const unsubscribe = session.on((event) => {
      const eventType = event.type;

      if (eventType === 'assistant.message_delta') {
        const data = event.data as { deltaContent?: string };
        if (data.deltaContent) {
          if (streamingMetrics.firstDeltaMs === null) {
            streamingMetrics.firstDeltaMs = nowMs() - startTime;
          }
          totalContent += data.deltaContent;
          eventQueue.push({ type: 'delta', content: data.deltaContent });
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
      // Send the message
      await session.send({ prompt: enhancedPrompt });

      // Yield events as they arrive
      while (true) {
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
            setTimeout(() => resolve('more'), 20);
          }),
        ]);

        if (raceResult === 'idle') {
          while (eventQueue.length > 0) {
            yield eventQueue.shift()!;
          }
          break;
        }
      }

      // Complete logging
      complete({
        text: totalContent.slice(0, 100),
        fullResponse: totalContent,
        toolsUsed: [],
        metadata: {
          firstTokenMs: streamingMetrics.firstDeltaMs,
          conversationId: newConversationId,
        },
      });

      // Yield done event
      yield {
        type: 'done',
        totalContent,
        toolCalls,
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
      // Don't destroy session if reusing conversation
      if (!conversationId) {
        session.destroy().catch((err) => {
          log.warn('Session destroy warning:', err);
        });
      }
    },
    model,
    newConversationId,
    streamingMetrics,
  };
}
