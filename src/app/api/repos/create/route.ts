/**
 * Repository Creation API Route
 * POST /api/repos/create
 *
 * Creates a new GitHub repository with an AI-generated README.
 * Uses Copilot SDK to generate a README based on the learning topic.
 *
 * @see {@link createRepository} for the underlying implementation
 */

import { authErrorResponse, parseJsonBody, validationErrorResponse } from '@/lib/api';
import { now, nowMs } from '@/lib/utils/date-utils';
import { handleApiError } from '@/lib/api-error';
import { type CreateRepoRequest, validateCreateRepoRequest } from '@/lib/github/api-requests';
import { getOctokitForRequest } from '@/lib/github/client';
import { generateLearningReadme } from '@/lib/github/readme';
import { createRepository, getFileShaWithRetry, updateRepoFile } from '@/lib/github/repos';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { requireUserContext } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Repos API');

/** Response for successful repository creation */
interface RepoResponse {
  success: true;
  repo: {
    name: string;
    fullName: string;
    url: string;
    cloneUrl: string;
    isPrivate: boolean;
  };
  readme: {
    generated: boolean;
    content?: string;
  };
  meta: {
    createdAt: string;
    totalTimeMs: number;
    aiEnabled: boolean;
  };
}

/** Response for failed repository creation */
interface ErrorResponse {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
}

/**
 * POST /api/repos/create
 *
 * Creates a new GitHub repository with an optional AI-generated README.
 *
 * @example
 * ```typescript
 * fetch('/api/repos/create', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     name: 'learn-typescript-generics',
 *     description: 'Practice with TypeScript generic patterns',
 *     isPrivate: false,
 *     topic: 'TypeScript Generics'
 *   })
 * });
 * ```
 */
export async function POST(request: NextRequest): Promise<Response> {
  const startTime = nowMs();
  log.info('POST request started');

  // Parse and validate request body
  const parseResult = await parseJsonBody<CreateRepoRequest>(request);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const validationError = validateCreateRepoRequest(parseResult.data);
  if (validationError) {
    return validationErrorResponse(validationError, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const req = parseResult.data;

  try {
    const octokit = await getOctokitForRequest();
    const ctx = await requireUserContext();
    const identity = createSessionIdentity(ctx);

    // Start README generation immediately if a topic was provided — it only needs
    // request data so it can run concurrently with repository creation.
    const readmePromise = req.topic
      ? (log.info(`Generating README for topic: ${req.topic}`),
        generateLearningReadme(identity, {
          repoName: req.name,
          topic: req.topic,
          description: req.description,
        }))
      : null;

    // Create the repository (runs in parallel with README generation above)
    log.info(`Creating repository: ${req.name}`);
    const repo = await createRepository(octokit, {
      name: req.name,
      description: req.description,
      isPrivate: req.isPrivate ?? false,
      autoInit: true, // Creates with initial README
    });

    log.info(`Repository created: ${repo.fullName}`);

    // Early return if no README generation requested
    if (!req.topic || !readmePromise) {
      const totalTime = nowMs() - startTime;
      log.info(`Repository setup complete in ${totalTime}ms`);

      return NextResponse.json({
        success: true,
        repo: {
          name: repo.name,
          fullName: repo.fullName,
          url: repo.htmlUrl,
          cloneUrl: repo.cloneUrl,
          isPrivate: repo.isPrivate,
        },
        readme: {
          generated: false,
        },
        meta: {
          createdAt: now(),
          totalTimeMs: totalTime,
          aiEnabled: false,
        },
      } satisfies RepoResponse);
    }

    // Await README content (may already be resolved if AI was faster than repo creation)
    const readmeContent = await readmePromise;

    // Get the SHA of the existing README (created by auto_init)
    const [owner, repoName] = repo.fullName.split('/');

    const sha = await getFileShaWithRetry(octokit, owner, repoName, 'README.md');

    // Update the README with AI-generated content
    await updateRepoFile(
      octokit,
      owner,
      repoName,
      'README.md',
      readmeContent,
      `docs: Add learning-focused README for ${req.topic}`,
      sha ?? undefined,
    );

    log.info('README updated with AI-generated content');

    const totalTime = nowMs() - startTime;
    log.info(`Repository setup complete in ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      repo: {
        name: repo.name,
        fullName: repo.fullName,
        url: repo.htmlUrl,
        cloneUrl: repo.cloneUrl,
        isPrivate: repo.isPrivate,
      },
      readme: {
        generated: true,
        content: readmeContent,
      },
      meta: {
        createdAt: now(),
        totalTimeMs: totalTime,
        aiEnabled: true,
      },
    } satisfies RepoResponse);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse as NextResponse<ErrorResponse>;
    return handleApiError(error, 'Repos API', startTime);
  }
}
