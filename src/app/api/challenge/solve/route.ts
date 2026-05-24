/**
 * Challenge Solution Generation API Route
 * POST /api/challenge/solve
 *
 * Generates working solutions for all files in a challenge workspace using AI.
 * This is a debug-only feature to help test the evaluation system.
 *
 * Request body:
 * - challenge: ChallengeDef - The challenge definition
 * - files: Array<{name: string, content: string}> - Workspace files to generate solutions for
 *
 * Response:
 * - success: boolean - Whether solution generation succeeded
 * - files: Array<{name: string, content: string}> - Generated solution code for each file
 * - explanation: string - Brief explanation of the solution approach
 * - error: string - Error message if failed
 *
 * @remarks
 * This endpoint is intended for development/testing purposes only.
 * It should be used with the debug mode toggle.
 * Supports multi-file workspaces (e.g., solution.ts + solution.test.ts).
 */

import { knownApiErrorResponse, parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { validateSolveRequest } from '@/lib/challenge/request-validators';
import {
    buildSolutionPrompt,
    SOLUTION_GENERATION_PROMPT,
} from '@/lib/challenge/solution-generation';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { executeCopilotCoachJob } from '@/lib/copilot/execution';
import type { ChallengeDef } from '@/lib/copilot/types';
import { requireUserContext } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { extractJSON } from '@/lib/utils/json-utils';
import { NextRequest } from 'next/server';

const log = logger.withTag('Solve API');


/** Request body structure */
interface SolveRequest {
  challenge: ChallengeDef;
  /** Workspace files to generate solutions for */
  files: Array<{ name: string; content: string }>;
}

export async function POST(request: NextRequest) {
  const startTime = nowMs();

  try {
    const parseResult = await parseJsonBody<SolveRequest>(request);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ success: false, error: parseResult.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate request
    const validationError = validateSolveRequest(parseResult.data);
    if (validationError) {
      return new Response(JSON.stringify({ success: false, error: validationError }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { challenge, files } = parseResult.data;

    const ctx = await requireUserContext();
    const identity = createSessionIdentity(ctx);

    log.info(`Generating solution for: ${challenge.title} (${files.length} files)`);

    // Build the solution prompt with system prompt injected
    const systemPromptedPrompt = `${SOLUTION_GENERATION_PROMPT}\n\n---\n\n${buildSolutionPrompt(challenge, files)}`;

    const result = await executeCopilotCoachJob({
      identity,
      variant: 'coach',
      operationName: 'Challenge Solution Generation',
      prompt: systemPromptedPrompt,
      inputSummary: systemPromptedPrompt.slice(0, 100),
    });

    const totalTime = nowMs() - startTime;
    log.info(`Solution generated in ${totalTime}ms`);

    const parsedResponse = extractJSON<{
      files?: Array<{ name: string; content: string }>;
      explanation?: string;
    }>(result.response, 'Solution Generation');

    if (!parsedResponse) {
      log.error('Failed to parse solution response');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Failed to parse AI response',
          rawResponse: result.response,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!parsedResponse.files || !Array.isArray(parsedResponse.files) || parsedResponse.files.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No files in AI response',
          rawResponse: result.response,
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        files: parsedResponse.files,
        explanation: parsedResponse.explanation ?? 'Solution generated successfully',
        meta: {
          totalMs: totalTime,
          model: result.meta.model,
          challengeTitle: challenge.title,
          challengeDifficulty: challenge.difficulty,
          filesGenerated: parsedResponse.files.length,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const knownResponse = knownApiErrorResponse(error);
    if (knownResponse) return knownResponse;

    const totalTime = nowMs() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate solution';
    log.error(`Error after ${totalTime}ms:`, errorMessage);

    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
