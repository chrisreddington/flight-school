/**
 * Challenge Hint API Route
 * POST /api/challenge/hint
 *
 * Provides progressive hints for coding challenges.
 * Supports stateless single hints or can be used with session management on the client.
 *
 * Request body:
 * - challenge: ChallengeDef - The challenge definition
 * - question: string - User's question or request for help
 * - currentCode: string - User's current code
 *
 * Response:
 * - hint: string - The hint text
 * - isFinalHint: boolean - Whether this is the last hint before giving away solution
 * - concepts: string[] - Related concepts to review
 * - suggestedFollowUp: string - Suggested next question
 * - meta: { totalTimeMs, model }
 *
 * @see SPEC-002 for hint requirements (AC3.1-AC3.4)
 */

import { parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { handleApiError } from '@/lib/api-error';
import { validateHintRequest } from '@/lib/challenge/request-validators';
import { getHint } from '@/lib/copilot/hints';
import type { ChallengeDef, HintResult } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Hint API');

/** Request body structure */
interface HintRequest {
  challenge: ChallengeDef;
  question: string;
  currentCode: string;
}

/** Success response */
interface HintResponse {
  success: true;
  hint: string;
  isFinalHint: boolean;
  concepts?: string[];
  suggestedFollowUp?: string;
  meta: {
    totalTimeMs: number;
    challengeTitle: string;
  };
}

/** Error response */
interface ErrorResponse {
  success: false;
  error: string;
  meta: {
    totalTimeMs: number;
  };
}

/**
 * POST /api/challenge/hint
 *
 * Get a hint for a coding challenge.
 *
 * @example
 * ```typescript
 * const response = await fetch('/api/challenge/hint', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     challenge: {
 *       title: 'Reverse a String',
 *       description: 'Write a function that reverses a string.',
 *       language: 'TypeScript',
 *       difficulty: 'beginner',
 *     },
 *     question: 'How do I start?',
 *     currentCode: 'function reverse(s: string) { }',
 *   }),
 * });
 *
 * const { hint, concepts } = await response.json();
 * // hint: "Think about what operations you can do on strings..."
 * // concepts: ["string methods", "array conversion"]
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<HintResponse | ErrorResponse>> {
  const startTime = nowMs();
  log.info('POST request started');

  // Parse and validate request body
  const parseResult = await parseJsonBody<HintRequest>(request);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: parseResult.error,
        meta: { totalTimeMs: nowMs() - startTime },
      } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const validationError = validateHintRequest(parseResult.data);
  if (validationError) {
    return NextResponse.json(
      {
        success: false,
        error: validationError,
        meta: { totalTimeMs: nowMs() - startTime },
      } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const { challenge, question, currentCode } = parseResult.data;

  try {
    log.info(`Getting hint for: ${challenge.title}`);

    const hintResult: HintResult = await getHint(challenge, question, currentCode);

    const totalTime = nowMs() - startTime;
    log.info(`Hint generated in ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      hint: hintResult.hint,
      isFinalHint: hintResult.isFinalHint,
      concepts: hintResult.concepts,
      suggestedFollowUp: hintResult.suggestedFollowUp,
      meta: {
        totalTimeMs: totalTime,
        challengeTitle: challenge.title,
      },
    } satisfies HintResponse);
  } catch (error) {
    return handleApiError(error, 'Hint API', startTime);
  }
}
