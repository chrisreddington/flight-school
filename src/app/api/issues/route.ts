/**
 * Issues API Route
 * POST /api/issues
 *
 * Creates GitHub issues via Octokit.
 * Used for creating learning goal issues from Daily Focus suggestions.
 *
 * @see {@link createIssue} for the underlying implementation
 * @see {@link createLearningGoalIssue} for learning-specific issue creation
 */

import { parseJsonBody, serviceUnavailableResponse, validationErrorResponse } from '@/lib/api';
import { now, nowMs } from '@/lib/utils/date-utils';
import { handleApiError } from '@/lib/api-error';
import {
  type IssueRequest,
  validateIssueRequest,
} from '@/lib/github/api-requests';
import { isGitHubConfigured } from '@/lib/github/client';
import { createIssue, createLearningGoalIssue } from '@/lib/github/issues';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Issues API');

/** Response for successful issue creation */
interface IssueResponse {
  success: true;
  issue: {
    number: number;
    title: string;
    url: string;
  };
  meta: {
    createdAt: string;
    totalTimeMs: number;
  };
}

/** Response for failed issue creation */
interface ErrorResponse {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
}

/**
 * POST /api/issues
 *
 * Creates a GitHub issue. Supports two types:
 * - `generic`: Standard issue with title, body, labels
 * - `learning-goal`: Pre-formatted learning goal issue
 *
 * @example
 * ```typescript
 * // Generic issue
 * fetch('/api/issues', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     type: 'generic',
 *     owner: 'octocat',
 *     repo: 'hello-world',
 *     title: 'Bug fix',
 *     body: 'Description here',
 *     labels: ['bug']
 *   })
 * });
 *
 * // Learning goal issue
 * fetch('/api/issues', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     type: 'learning-goal',
 *     owner: 'octocat',
 *     repo: 'hello-world',
 *     topic: 'TypeScript Generics',
 *     description: 'Master conditional types'
 *   })
 * });
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<IssueResponse | ErrorResponse>> {
  const startTime = nowMs();
  log.info('POST request started');

  // Check GitHub configuration
  if (!(await isGitHubConfigured())) {
    log.warn('GitHub not configured');
    return serviceUnavailableResponse('GitHub authentication not configured', {
      totalTimeMs: nowMs() - startTime,
    });
  }

  // Parse and validate request body
  const parseResult = await parseJsonBody<IssueRequest>(request);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const validationError = validateIssueRequest(parseResult.data);
  if (validationError) {
    return validationErrorResponse(validationError, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const req = parseResult.data;

  try {
    let result;

    if (req.type === 'generic') {
      log.info(`Creating generic issue in ${req.owner}/${req.repo}`);
      result = await createIssue({
        owner: req.owner,
        repo: req.repo,
        title: req.title,
        body: req.body,
        labels: req.labels,
      });
    } else {
      log.info(`Creating learning goal issue in ${req.owner}/${req.repo}`);
      result = await createLearningGoalIssue(
        req.owner,
        req.repo,
        req.topic,
        req.description
      );
    }

    const totalTime = nowMs() - startTime;
    log.info(`Issue #${result.number} created in ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      issue: {
        number: result.number,
        title: result.title,
        url: result.htmlUrl,
      },
      meta: {
        createdAt: now(),
        totalTimeMs: totalTime,
      },
    } satisfies IssueResponse);
  } catch (error) {
    return handleApiError(error, 'Issues API', startTime);
  }
}
