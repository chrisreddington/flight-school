/**
 * Workspace Export API Route
 * POST /api/repos/create-from-workspace
 *
 * Creates a new GitHub repository from challenge workspace files.
 * Generates README.md with challenge context and optionally HINTS.md.
 *
 * @see {@link createRepository} for the underlying implementation
 */

import { parseJsonBody, serviceUnavailableResponse, validationErrorResponse } from '@/lib/api';
import { now, nowMs } from '@/lib/utils/date-utils';
import { handleApiError } from '@/lib/api-error';
import {
  type ExportWorkspaceRequest,
  validateExportWorkspaceRequest,
} from '@/lib/github/api-requests';
import { getOctokit, isGitHubConfigured } from '@/lib/github/client';
import { createRepository, getRepositoryState } from '@/lib/github/repos';
import { getAuthenticatedUser } from '@/lib/github/user';
import { buildWorkspaceExportFiles } from '@/lib/github/workspace-export';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Workspace Export API');

/** Response for successful export */
interface ExportSuccessResponse {
  success: true;
  repoUrl: string;
  repoName: string;
  filesCommitted: number;
  meta: {
    createdAt: string;
    totalTimeMs: number;
  };
}

/** Response for failed export */
interface ExportErrorResponse {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
}

// =============================================================================
// API Handler
// =============================================================================

/**
 * POST /api/repos/create-from-workspace
 *
 * Creates a new GitHub repository from workspace files.
 * This endpoint is idempotent - if the repo exists but is empty (from a
 * previous failed attempt), it will complete the export.
 *
 * @example
 * ```typescript
 * fetch('/api/repos/create-from-workspace', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     challengeId: 'challenge-123',
 *     repoName: 'challenge-reverse-string',
 *     files: [{ name: 'solution.ts', content: '...' }],
 *     challenge: { title: 'Reverse String', language: 'TypeScript', ... }
 *   })
 * });
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<ExportSuccessResponse | ExportErrorResponse>> {
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
  const parseResult = await parseJsonBody<ExportWorkspaceRequest>(request);
  if (!parseResult.success) {
    return validationErrorResponse(parseResult.error, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const validationError = validateExportWorkspaceRequest(parseResult.data);
  if (validationError) {
    return validationErrorResponse(validationError, {
      totalTimeMs: nowMs() - startTime,
    });
  }

  const req = parseResult.data;
  let owner: string;
  let octokit: Awaited<ReturnType<typeof getOctokit>>;

  try {
    octokit = await getOctokit();
    const user = await getAuthenticatedUser();
    owner = user.login;
  } catch (error) {
    const errorStatus = (error as { status?: number })?.status;
    const responseMessage = `Failed to authenticate with GitHub. ${
      errorStatus === 401 ? 'Token may be invalid or expired.' : 'Please check your token.'
    }`;

    return handleApiError(error, 'Workspace Export API', startTime, {
      responseMessage,
      statusCode: 401,
    });
  }

  try {
    // Step 1: Check if repository already exists
    log.info(`Checking if repository exists: ${owner}/${req.repoName}`);
    const repoState = await getRepositoryState(owner, req.repoName);
    log.info(`Repository state: exists=${repoState.exists}, hasCommits=${repoState.hasCommits}`);

    if (repoState.exists && repoState.hasCommits) {
      // Repo exists with commits - user needs a different name
      log.warn(`Repository ${req.repoName} already exists with content`);
      return NextResponse.json(
        {
          success: false,
          error: `Repository "${req.repoName}" already exists. Please choose a different name.`,
          meta: { totalTimeMs: nowMs() - startTime },
        } satisfies ExportErrorResponse,
        { status: 409 }
      );
    }

    let repoUrl: string;
    let isNewRepo = false;

    if (!repoState.exists) {
      // Create new repository with auto_init to have a base commit
      log.info(`Creating new repository: ${req.repoName}`);
      const repo = await createRepository({
        name: req.repoName,
        description: req.description || `Solution: ${req.challenge.title}`,
        isPrivate: req.isPrivate ?? false,
        autoInit: true, // Creates initial commit with README
      });

      log.info(`Repository created: ${repo.fullName}`);
      repoUrl = repo.htmlUrl;
      isNewRepo = true;
    } else {
      // Repo exists but has no commits (shouldn't happen, but handle it)
      log.info(`Repository ${req.repoName} exists but has no commits`);
      repoUrl = `https://github.com/${owner}/${req.repoName}`;
    }

    // Step 2: Prepare files for commit
    const filesToCommit = buildWorkspaceExportFiles({
      challenge: req.challenge,
      files: req.files,
      evaluation: req.evaluation,
      hints: req.hints,
    });

    // Step 3: Get current HEAD commit (from auto-init or existing repo)
    const { data: repoData } = await octokit.rest.repos.get({
      owner,
      repo: req.repoName,
    });
    const defaultBranch = repoData.default_branch || 'main';

    const { data: ref } = await octokit.rest.git.getRef({
      owner,
      repo: req.repoName,
      ref: `heads/${defaultBranch}`,
    });
    const currentCommitSha = ref.object.sha;

    // Step 4: Create blobs for each file
    log.info(`Creating ${filesToCommit.length} blobs`);
    const blobPromises = filesToCommit.map((file) =>
      octokit.rest.git.createBlob({
        owner,
        repo: req.repoName,
        content: Buffer.from(file.content).toString('base64'),
        encoding: 'base64',
      })
    );
    const blobResults = await Promise.all(blobPromises);
    const blobs = blobResults.map((r) => r.data.sha);
    log.info(`Created ${blobs.length} blobs`);

    // Step 5: Create tree with new files
    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo: req.repoName,
      base_tree: isNewRepo ? currentCommitSha : undefined, // Keep auto-init README for new repos
      tree: filesToCommit.map((file, index) => ({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: blobs[index],
      })),
    });
    log.info(`Created tree: ${tree.sha}`);

    // Step 6: Create commit
    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo: req.repoName,
      message: isNewRepo 
        ? `feat: Export challenge workspace - ${req.challenge.title}`
        : `feat: Add challenge files - ${req.challenge.title}`,
      tree: tree.sha,
      parents: [currentCommitSha],
    });
    log.info(`Created commit: ${commit.sha}`);

    // Step 7: Update branch reference
    await octokit.rest.git.updateRef({
      owner,
      repo: req.repoName,
      ref: `heads/${defaultBranch}`,
      sha: commit.sha,
    });
    log.info(`Updated ${defaultBranch} branch to ${commit.sha}`);

    const totalTime = nowMs() - startTime;
    log.info(`Workspace export complete in ${totalTime}ms`);

    return NextResponse.json({
      success: true,
      repoUrl,
      repoName: `${owner}/${req.repoName}`,
      filesCommitted: filesToCommit.length,
      meta: {
        createdAt: now(),
        totalTimeMs: totalTime,
      },
    } satisfies ExportSuccessResponse);
  } catch (error) {
    const errorStatus = (error as { status?: number })?.status;
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Workspace export failed: status=${errorStatus}, message=${errorMessage}`, error);

    let userMessage = 'An unexpected error occurred. Please try again.';
    let statusCode: number | undefined;

    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (message.includes('name already exists') || (errorStatus === 422 && message.includes('already exists'))) {
        userMessage = `Repository "${req.repoName}" already exists. Please choose a different name.`;
        statusCode = 409;
      } else if (errorStatus === 403 && message.includes('rate limit')) {
        userMessage = 'GitHub rate limit exceeded. Please wait a minute and try again.';
        statusCode = 429;
      } else if (errorStatus === 401 || message.includes('bad credentials')) {
        userMessage = 'GitHub authentication failed. Please check that you are logged in.';
        statusCode = 401;
      } else {
        userMessage = `Export failed: ${error.message}`;
      }
    }

    return handleApiError(error, 'Workspace Export API', startTime, {
      responseMessage: userMessage,
      statusCode,
    });
  }
}
