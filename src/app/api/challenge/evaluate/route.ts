/**
 * Challenge Evaluation Streaming API Route
 * POST /api/challenge/evaluate
 *
 * Uses Server-Sent Events (SSE) to stream evaluation feedback.
 * Sends metadata early, then streams feedback text in real-time.
 *
 * Request body:
 * - challenge: ChallengeDef - The challenge definition
 * - files: Array<{name: string, content: string}> - Workspace files
 *
 * Response (SSE events):
 * - partial: { type: 'partial', isCorrect, score, strengths, improvements, nextSteps } - Early metadata
 * - feedback-delta: { type: 'feedback-delta', content: string } - Streaming feedback text
 * - result: { type: 'result', ...EvaluationResult } - Complete evaluation result
 * - meta: { type: 'meta', model: string, totalMs: number } - Timing metadata
 * - [DONE]: End of stream
 *
 * @see SPEC-002 for challenge sandbox requirements (AC2.1-AC2.4)
 * @see SPEC-004 for multi-file workspace support
 */

import { createSSEResponse, parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { validateEvaluateRequest } from '@/lib/challenge/request-validators';
import {
    buildEvaluationPrompt,
    EVALUATION_SYSTEM_PROMPT,
    extractStreamingFeedback,
    parseEvaluationResponse,
    parsePartialEvaluation,
    type WorkspaceFileInput,
} from '@/lib/copilot/evaluation';
import { createEvaluationStreamingSession } from '@/lib/copilot/streaming';
import type { ChallengeDef } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { EVAL_GUARD } from '@/lib/security/route-defaults';
import { NextRequest } from 'next/server';

const log = logger.withTag('Evaluate API');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Request body structure */
interface EvaluateRequest {
  challenge: ChallengeDef;
  /** Workspace files to evaluate */
  files: WorkspaceFileInput[];
}

export async function POST(request: NextRequest) {
  const startTime = nowMs();

  try {
    const parseResult = await parseJsonBody<EvaluateRequest>(request);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: parseResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate request
    const validationError = validateEvaluateRequest(parseResult.data);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { challenge, files } = parseResult.data;

    return await withUserGuards(
      {
        ...EVAL_GUARD,
        eventType: 'copilot.session.create',
        auditMetadata: {
          route: '/api/challenge/evaluate',
          action: 'challenge_evaluate',
          challengeTitle: challenge.title,
        },
      },
      async (userCtx) => {
        log.info(`Evaluating solution for: ${challenge.title} (${files.length} files)`);

        // Build the evaluation prompt
        const prompt = buildEvaluationPrompt(challenge, files);

        // Create streaming session with evaluation system prompt
        // Use dedicated evaluation session factory for proper logging separation
        const { stream, cleanup, model, streamingMetrics } = await createEvaluationStreamingSession(
          { userId: userCtx.userId, gitHubToken: userCtx.accessToken },
          prompt,
          EVALUATION_SYSTEM_PROMPT,
          'Challenge Evaluation'
        );

        const sessionCreateTime = nowMs() - startTime;
        log.info(`Session created in ${sessionCreateTime}ms`);

        // Track full content for parsing
        let fullContent = '';
        // Track whether we've sent the partial metadata
        let sentPartial = false;
        // Track feedback text sent so far
        let lastFeedbackLength = 0;

        // NOTE: `withUserGuards` releases the concurrent-session slot when this
        // callback returns (i.e. as soon as the SSE Response object is handed
        // back to Next.js). The underlying Copilot session is still cleaned up
        // separately via the SSE `cleanup` callback below when the stream
        // finishes or the client disconnects. Releasing the slot at handler
        // return keeps the cap consistent with other AI routes and matches the
        // guard contract.
        return createSSEResponse(
          async function* () {
            for await (const event of stream) {
              if (event.type === 'delta') {
                fullContent += event.content;

                if (!sentPartial) {
                  const partial = parsePartialEvaluation(fullContent);
                  if (partial) {
                    sentPartial = true;
                    log.debug(`Sent partial result: isCorrect=${partial.isCorrect}`);
                    yield { type: 'partial' as const, ...partial };
                  }
                }

                if (sentPartial) {
                  const currentFeedback = extractStreamingFeedback(fullContent);
                  if (currentFeedback.length > lastFeedbackLength) {
                    const newContent = currentFeedback.slice(lastFeedbackLength);
                    lastFeedbackLength = currentFeedback.length;
                    yield { type: 'feedback-delta' as const, content: newContent };
                  }
                }
              }

              if (event.type === 'done') {
                fullContent = event.totalContent;
              }
            }

            const evaluationResult = parseEvaluationResponse(fullContent);

            if (evaluationResult) {
              yield { type: 'result' as const, ...evaluationResult };
            } else {
              yield {
                type: 'result' as const,
                isCorrect: false,
                feedback: fullContent || 'Unable to parse evaluation.',
                strengths: [],
                improvements: ['Please try submitting again.'],
              };
            }
          },
          {
            onComplete: () => ({
              type: 'meta' as const,
              model,
              sessionCreateMs: sessionCreateTime,
              totalMs: nowMs() - startTime,
              firstDeltaMs: streamingMetrics.firstDeltaMs,
              challengeTitle: challenge.title,
              challengeDifficulty: challenge.difficulty,
            }),
            onError: (error) => {
              const errorMessage = error instanceof Error ? error.message : 'Stream error';
              log.error('Stream error:', errorMessage);
            },
            cleanup,
          }
        );
      },
    );
  } catch (error) {
    const guardResponse = guardErrorResponse(error);
    if (guardResponse) return guardResponse;

    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to start evaluation';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
