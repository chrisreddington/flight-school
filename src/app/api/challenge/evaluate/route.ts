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
import { requireUserContext } from '@/lib/auth/context';
import { auditLog, hashUserId } from '@/lib/security/audit';
import { guardErrorResponse } from '@/lib/security/http';
import { checkRateLimit, RateLimitedError } from '@/lib/security/rate-limit';
import { EVAL_GUARD } from '@/lib/security/route-defaults';
import { acquireSlot } from '@/lib/security/session-cap';
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

    const userCtx = await requireUserContext();
    const userIdHash = hashUserId(userCtx.userId);

    const rl = checkRateLimit(userCtx.userId, EVAL_GUARD.rateLimit.limit, EVAL_GUARD.rateLimit.windowMs);
    if (!rl.allowed) {
      auditLog({ type: 'rate-limit.blocked', userIdHash, metadata: { route: '/api/challenge/evaluate', retryAfterMs: rl.retryAfterMs } });
      throw new RateLimitedError(rl.retryAfterMs ?? EVAL_GUARD.rateLimit.windowMs);
    }

    const releaseSlot = await acquireSlot(userCtx.userId, EVAL_GUARD.concurrentCap);
    auditLog({
      type: 'copilot.session.create',
      userIdHash,
      metadata: { route: '/api/challenge/evaluate', challengeTitle: challenge.title },
    });

    log.info(`Evaluating solution for: ${challenge.title} (${files.length} files)`);

    // Build the evaluation prompt
    const prompt = buildEvaluationPrompt(challenge, files);

    // Create streaming session with evaluation system prompt
    // Use dedicated evaluation session factory for proper logging separation
    let stream: Awaited<ReturnType<typeof createEvaluationStreamingSession>>['stream'];
    let cleanup: Awaited<ReturnType<typeof createEvaluationStreamingSession>>['cleanup'];
    let model: Awaited<ReturnType<typeof createEvaluationStreamingSession>>['model'];
    let streamingMetrics: Awaited<ReturnType<typeof createEvaluationStreamingSession>>['streamingMetrics'];
    try {
      ({ stream, cleanup, model, streamingMetrics } = await createEvaluationStreamingSession(
        { userId: userCtx.userId, gitHubToken: userCtx.accessToken },
        prompt,
        EVALUATION_SYSTEM_PROMPT,
        'Challenge Evaluation'
      ));
    } catch (error) {
      releaseSlot();
      throw error;
    }

    const sessionCreateTime = nowMs() - startTime;
    log.info(`Session created in ${sessionCreateTime}ms`);

    // Track full content for parsing
    let fullContent = '';
    // Track whether we've sent the partial metadata
    let sentPartial = false;
    // Track feedback text sent so far
    let lastFeedbackLength = 0;

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
        cleanup: () => {
          try { cleanup(); } finally { releaseSlot(); }
        },
      }
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
