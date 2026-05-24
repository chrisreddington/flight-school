/**
 * Workspace Storage API Route
 *
 * Server-side file-based persistence for challenge workspaces, **partitioned
 * per authenticated user**. Each authenticated request resolves its GitHub
 * identity via {@link requireUserContext} and the workspace tree lives under
 * `users/{userId}/workspaces/...` — User A cannot reach User B's workspaces.
 *
 * Storage structure (per user):
 * ```
 * users/{userId}/workspaces/
 *   {challengeId}/
 *     _workspace.json    # metadata only
 *     solution.ts        # actual file content
 * ```
 *
 * Endpoints:
 * - GET ?challengeId=X           - Read workspace (full or metadata only)
 * - POST                         - Save workspace
 * - DELETE ?challengeId=X        - Delete specific workspace
 * - DELETE (no params)           - Delete all workspaces for this user
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  readFile,
  writeFile,
  deleteFile,
  deleteDir,
  listFiles,
  ensureDir,
  safeChildPath
} from '@/lib/storage/utils';
import type { ChallengeWorkspace, WorkspaceFile, WorkspaceMetadata } from '@/lib/workspace/types';
import {
  WORKSPACES_DIR,
  METADATA_FILENAME,
  toFileMetadata,
  toWorkspaceFile
} from '@/lib/workspace/storage';
import { requireUserContext } from '@/lib/auth/context';
import { authErrorResponse, validationErrorResponse } from '@/lib/api';
import { logger } from '@/lib/logger';

const log = logger.withTag('Workspace Storage API');

/**
 * Matches values that are safe to embed verbatim into a filesystem path
 * segment. Used to defensively reject userIds and challenge IDs that could
 * otherwise escape the per-user workspace directory.
 */
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9_-]+$/;

/** Maximum length allowed for a workspace filename (incl. any subpath). */
const MAX_WORKSPACE_FILENAME_LENGTH = 255;

/**
 * Validates that `name` is a safe workspace filename: it may consist of one or
 * more `/`-separated segments, each matching a conservative character class,
 * and the resolved path must stay under `workspaceDir`. Throws on rejection.
 */
function assertSafeWorkspaceFilename(workspaceDir: string, name: unknown): void {
  if (typeof name !== 'string') {
    throw new Error('filename must be a string');
  }
  if (name.length === 0 || name.length > MAX_WORKSPACE_FILENAME_LENGTH) {
    throw new Error('filename length out of bounds');
  }
  const segments = name.split('/');
  const segmentPattern = /^[a-zA-Z0-9._-]+$/;
  for (const segment of segments) {
    if (!segmentPattern.test(segment)) {
      throw new Error(`invalid filename segment "${segment}"`);
    }
  }
  // Structural + containment check (rejects `..`, `\`, NUL, absolute, etc.).
  safeChildPath(workspaceDir, ...segments);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Resolves the authenticated user's workspaces root, or returns an HTTP
 * response describing why the request can't proceed.
 */
async function resolveUserWorkspacesDir(): Promise<
  { ok: true; userId: string; root: string } | { ok: false; response: NextResponse }
> {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return { ok: false, response: authResponse };
    throw error;
  }

  if (!SAFE_PATH_SEGMENT.test(userId)) {
    log.warn('Rejected unsafe userId', { userId });
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid user identifier' }, { status: 400 }),
    };
  }

  const root = `users/${userId}/${WORKSPACES_DIR}`;
  await ensureDir(`users/${userId}`, { mode: 0o700 });
  return { ok: true, userId, root };
}

function getWorkspaceDir(workspacesRoot: string, challengeId: string): string {
  return `${workspacesRoot}/${challengeId}`;
}

// =============================================================================
// GET: Read workspace
// =============================================================================

export async function GET(request: NextRequest) {
  const scoped = await resolveUserWorkspacesDir();
  if (!scoped.ok) return scoped.response;

  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get('challengeId');
  const metadataOnly = searchParams.get('metadataOnly') === 'true';

  if (!challengeId) {
    return NextResponse.json({ error: 'challengeId required' }, { status: 400 });
  }
  if (!SAFE_PATH_SEGMENT.test(challengeId)) {
    return NextResponse.json({ error: 'Invalid challengeId' }, { status: 400 });
  }

  try {
    const workspaceDir = getWorkspaceDir(scoped.root, challengeId);

    const metadataJson = await readFile(workspaceDir, METADATA_FILENAME);
    if (!metadataJson) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const metadata: WorkspaceMetadata = JSON.parse(metadataJson);

    if (metadataOnly) {
      return NextResponse.json(metadata);
    }

    const files: WorkspaceFile[] = await Promise.all(
      metadata.files.map(async (fileMeta) => {
        // Defence in depth: reject filenames that escape the workspace
        // subtree (in case any were persisted before validation was added).
        try {
          assertSafeWorkspaceFilename(workspaceDir, fileMeta.name);
        } catch (validationError) {
          log.warn('Skipping workspace file with unsafe name on read', {
            challengeId,
            name: fileMeta.name,
            error: validationError instanceof Error ? validationError.message : String(validationError),
          });
          return toWorkspaceFile(fileMeta, '');
        }
        const content = await readFile(workspaceDir, fileMeta.name) ?? '';
        return toWorkspaceFile(fileMeta, content);
      })
    );

    const workspace: ChallengeWorkspace = {
      version: metadata.version,
      challengeId: metadata.challengeId,
      files,
      activeFileId: metadata.activeFileId,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    };

    return NextResponse.json(workspace);
  } catch (error) {
    log.error('GET /api/workspace/storage failed', { challengeId, error });
    return NextResponse.json({ error: 'Failed to read workspace' }, { status: 500 });
  }
}

// =============================================================================
// POST: Save workspace
// =============================================================================

export async function POST(request: NextRequest) {
  const scoped = await resolveUserWorkspacesDir();
  if (!scoped.ok) return scoped.response;

  try {
    const workspace: ChallengeWorkspace = await request.json();

    if (!workspace.challengeId || !workspace.files) {
      return NextResponse.json({ error: 'Invalid workspace data' }, { status: 400 });
    }
    if (!SAFE_PATH_SEGMENT.test(workspace.challengeId)) {
      return NextResponse.json({ error: 'Invalid challengeId' }, { status: 400 });
    }

    const workspaceDir = getWorkspaceDir(scoped.root, workspace.challengeId);

    // Validate every caller-supplied filename BEFORE touching the filesystem.
    // Any rejection -> 400 and no partial writes.
    try {
      for (const file of workspace.files) {
        assertSafeWorkspaceFilename(workspaceDir, file?.name);
      }
    } catch (validationError) {
      log.warn('Rejected workspace POST with unsafe filename', {
        challengeId: workspace.challengeId,
        error: validationError instanceof Error ? validationError.message : String(validationError),
      });
      return validationErrorResponse('Invalid file name');
    }

    await ensureDir(workspaceDir);

    const existingFiles = await listFiles(workspaceDir);
    const newFileNames = new Set(workspace.files.map(f => f.name));
    newFileNames.add(METADATA_FILENAME);

    for (const existingFile of existingFiles) {
      if (!newFileNames.has(existingFile)) {
        await deleteFile(workspaceDir, existingFile);
      }
    }

    await Promise.all(
      workspace.files.map(file => writeFile(workspaceDir, file.name, file.content))
    );

    const metadata: WorkspaceMetadata = {
      version: workspace.version,
      challengeId: workspace.challengeId,
      files: workspace.files.map(toFileMetadata),
      activeFileId: workspace.activeFileId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };

    await writeFile(workspaceDir, METADATA_FILENAME, JSON.stringify(metadata, null, 2));

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('POST /api/workspace/storage failed', { error });
    return NextResponse.json({ error: 'Failed to save workspace' }, { status: 500 });
  }
}

// =============================================================================
// DELETE: Delete workspace(s)
// =============================================================================

export async function DELETE(request: NextRequest) {
  const scoped = await resolveUserWorkspacesDir();
  if (!scoped.ok) return scoped.response;

  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get('challengeId');

  try {
    if (challengeId) {
      if (!SAFE_PATH_SEGMENT.test(challengeId)) {
        return NextResponse.json({ error: 'Invalid challengeId' }, { status: 400 });
      }
      const workspaceDir = getWorkspaceDir(scoped.root, challengeId);
      await deleteDir(workspaceDir);
      log.debug('Deleted workspace', { challengeId });
    } else {
      // Delete all workspaces for this user only — never touch other users.
      await deleteDir(scoped.root);
      log.debug('Deleted all workspaces for user');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('DELETE /api/workspace/storage failed', { challengeId, error });
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
