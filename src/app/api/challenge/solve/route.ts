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

import { parseJsonBody } from '@/lib/api';
import { nowMs } from '@/lib/utils/date-utils';
import { validateSolveRequest } from '@/lib/challenge/request-validators';
import {
    buildSolutionPrompt,
    SOLUTION_GENERATION_PROMPT,
} from '@/lib/challenge/solution-generation';
import { createLoggedCoachSession } from '@/lib/copilot/server';
import type { ChallengeDef } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import { extractJSON } from '@/lib/utils/json-utils';
import { NextRequest } from 'next/server';

const log = logger.withTag('Solve API');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

    log.info(`Generating solution for: ${challenge.title} (${files.length} files)`);

    // Build the solution prompt with system prompt injected
    const systemPromptedPrompt = `${SOLUTION_GENERATION_PROMPT}\n\n---\n\n${buildSolutionPrompt(challenge, files)}`;

    // Create a logged session and send the prompt
    const session = await createLoggedCoachSession(
      'Challenge Solution Generation',
      systemPromptedPrompt.slice(0, 100)
    );

    try {
      const result = await session.sendAndWait(systemPromptedPrompt);

      const totalTime = nowMs() - startTime;
      log.info(`Solution generated in ${totalTime}ms`);

      // Parse the JSON response using centralized extraction utility
      const parsedResponse = extractJSON<{ 
        files?: Array<{ name: string; content: string }>; 
        explanation?: string; 
      }>(result.responseText, 'Solution Generation');
      
      if (!parsedResponse) {
        log.error('Failed to parse solution response');
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Failed to parse AI response',
            rawResponse: result.responseText,
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
            rawResponse: result.responseText,
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
            model: session.model,
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
    } finally {
      // Clean up the session
      await session.destroy();
    }
  } catch (error) {
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
