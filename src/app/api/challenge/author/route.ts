/**
 * Challenge Authoring Streaming API Route
 * POST /api/challenge/author
 *
 * Uses Server-Sent Events (SSE) to stream challenge authoring conversation.
 * Supports multi-turn conversation with clarifying questions and final generation.
 *
 * Request body:
 * - prompt: string - User's message or description of desired challenge
 * - conversationId?: string - Optional conversation ID for multi-turn support
 * - context?: AuthoringContext - Optional context (language, difficulty, template)
 * - action?: 'clarify' | 'generate' | 'validate' - Action type (default: depends on conversation stage)
 *
 * Response (SSE events):
 * - delta: { type: 'delta', content: string } - Streaming text
 * - challenge: { type: 'challenge', challenge: DailyChallenge } - Generated challenge
 * - validation: { type: 'validation', isValid: boolean, issues: string[] } - Validation result
 * - meta: { type: 'meta', model: string, totalMs: number, conversationId: string } - Metadata
 * - [DONE]: End of stream
 *
 * @see SPEC-006 for custom challenge authoring requirements (S1, AC1.1-AC1.4)
 */

import { createSSEResponse, parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { createGenericStreamingSession } from '@/lib/challenge/authoring/authoring-session';
import { parseGeneratedChallenge } from '@/lib/challenge/authoring/challenge-parser';
import type { AuthoringContext } from '@/lib/challenge/authoring/types';
import { validateAuthoringRequest } from '@/lib/challenge/authoring/validation';
import { logger } from '@/lib/logger';
import { NextRequest } from 'next/server';

const log = logger.withTag('Author API');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Request body structure */
interface AuthorRequest {
  prompt: string;
  conversationId?: string;
  context?: AuthoringContext;
  action?: 'clarify' | 'generate' | 'validate';
}

export async function POST(request: NextRequest) {
  const startTime = nowMs();

  try {
    const parseResult = await parseJsonBody<AuthorRequest>(request);
    if (!parseResult.success) {
      log.error(`Parse error: ${parseResult.error}`);
      return new Response(JSON.stringify({ error: parseResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate request
    const validationError = validateAuthoringRequest(parseResult.data);
    if (validationError) {
      log.error(`Validation error: ${validationError}`);
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { prompt, conversationId, context, action } = parseResult.data;

    log.info(`Authoring request: ${action || 'auto'} (conv: ${conversationId ? 'existing' : 'new'})`);

    // Create streaming session for authoring
    const { stream, cleanup, model, newConversationId, streamingMetrics } = await createGenericStreamingSession({
      prompt,
      conversationId,
      context,
      action,
    });

    const sessionCreateTime = nowMs() - startTime;
    log.info(`Session created in ${sessionCreateTime}ms`);

    // Track full content for parsing
    let fullContent = '';

    return createSSEResponse(
      async function* () {
        for await (const event of stream) {
          if (event.type === 'delta') {
            fullContent += event.content;
            yield { type: 'delta' as const, content: event.content };
          }

          if (event.type === 'done') {
            fullContent = event.totalContent;
          }
        }

        const parsedChallenge = parseGeneratedChallenge(fullContent);
        if (parsedChallenge) {
          yield { type: 'challenge' as const, challenge: parsedChallenge };
          log.info(`Parsed challenge: ${parsedChallenge.title}`);
        } else {
          log.debug(`No challenge parsed from response (length: ${fullContent.length})`);
        }
      },
      {
        onComplete: () => ({
          type: 'meta' as const,
          model,
          sessionCreateMs: sessionCreateTime,
          totalMs: nowMs() - startTime,
          firstDeltaMs: streamingMetrics.firstDeltaMs,
          conversationId: newConversationId,
        }),
        onError: (error) => {
          const errorMessage = error instanceof Error ? error.message : 'Stream error';
          log.error('Stream error:', errorMessage);
        },
        cleanup,
      }
    );
  } catch (error) {
    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to start authoring session';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
