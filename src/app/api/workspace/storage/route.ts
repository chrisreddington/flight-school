/**
 * Workspace Storage API Route
 *
 * Server-side persistence for challenge workspaces, **partitioned per
 * authenticated user**. Each request resolves its GitHub identity via
 * {@link requireUserContext}; all storage is delegated to
 * {@link workspacesRepo}, which keys each workspace by `challengeId` under the
 * user's `'workspaces'` envelope partition (with transparent read-through of any
 * residual legacy `users/{userId}/workspaces/{id}/...` file tree). User A can
 * never reach User B's workspaces.
 *
 * Endpoints:
 * - GET ?challengeId=X           - Read workspace (full or metadata only)
 * - POST                         - Save workspace
 * - DELETE ?challengeId=X        - Delete specific workspace
 * - DELETE (no params)           - Delete all workspaces for this user
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireUserContext } from '@/lib/auth/context';
import { authErrorResponse, validationErrorResponse } from '@/lib/api';
import { SAFE_PATH_SEGMENT } from '@/lib/storage/user-scope';
import { logger } from '@/lib/logger';
import { challengeSpecRepo } from '@/lib/challenge/repo';
import { getWorkspaceTemplate } from '@/lib/workspace/templates';
import { now } from '@/lib/utils/date-utils';
import { CURRENT_WORKSPACE_SCHEMA_VERSION } from '@/lib/workspace/types';
import type {
  ChallengeWorkspace,
  WorkspaceFile as WorkspaceTemplateFile,
  WorkspaceMetadata,
} from '@/lib/workspace/types';
import { WORKSPACES_DIR, toFileMetadata } from '@/lib/workspace/storage';
import { assertSafeWorkspaceFilename } from '@/lib/workspace/filename';
import { workspacesRepo } from '@/lib/workspace/repo';

const log = logger.withTag('Workspace Storage API');

/**
 * Resolves the authenticated, path-safe user id, or returns an HTTP response
 * describing why the request can't proceed.
 */
async function resolveUserId(): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
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

  return { ok: true, userId };
}

function buildStarterWorkspace(challengeId: string, files: WorkspaceTemplateFile[]): ChallengeWorkspace {
  const timestamp = now();
  return {
    version: CURRENT_WORKSPACE_SCHEMA_VERSION,
    challengeId,
    files,
    activeFileId: files[0]?.id ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Derive the metadata-only projection (per-file content stripped). */
function toWorkspaceMetadata(workspace: ChallengeWorkspace): WorkspaceMetadata {
  return {
    version: workspace.version,
    challengeId: workspace.challengeId,
    files: workspace.files.map(toFileMetadata),
    activeFileId: workspace.activeFileId,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

// =============================================================================
// GET: Read workspace
// =============================================================================

export async function GET(request: NextRequest) {
  const scoped = await resolveUserId();
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
    const workspace = await workspacesRepo.read(scoped.userId, challengeId);

    if (!workspace) {
      // No saved workspace: synthesise a starter from the challenge spec when
      // one exists. Historically this returns the FULL starter even for
      // metadataOnly requests — preserved so the sandbox's first load is
      // unaffected.
      const challengeSpec = await challengeSpecRepo.read(scoped.userId, challengeId);
      if (challengeSpec) {
        return NextResponse.json(
          buildStarterWorkspace(
            challengeId,
            getWorkspaceTemplate({
              title: challengeSpec.title,
              description: challengeSpec.description,
              type: challengeSpec.type,
              brokenCode: challengeSpec.brokenCode,
              language: challengeSpec.language,
              difficulty: challengeSpec.difficulty,
              testCases: [],
            }),
          ),
        );
      }
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    if (metadataOnly) {
      return NextResponse.json(toWorkspaceMetadata(workspace));
    }

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
  const scoped = await resolveUserId();
  if (!scoped.ok) return scoped.response;

  try {
    const workspace: ChallengeWorkspace = await request.json();

    // A JSON `null` body parses successfully but would crash the property reads
    // below; reject any non-object payload as a 400 rather than a 500.
    if (typeof workspace !== 'object' || workspace === null) {
      return NextResponse.json({ error: 'Invalid workspace data' }, { status: 400 });
    }
    if (!workspace.challengeId || !Array.isArray(workspace.files)) {
      return NextResponse.json({ error: 'Invalid workspace data' }, { status: 400 });
    }
    if (!SAFE_PATH_SEGMENT.test(workspace.challengeId)) {
      return NextResponse.json({ error: 'Invalid challengeId' }, { status: 400 });
    }

    // Validate every caller-supplied filename against the same rules the repo's
    // legacy read-through trusts. Any rejection -> 400, nothing persisted.
    const workspaceDir = `users/${scoped.userId}/${WORKSPACES_DIR}/${workspace.challengeId}`;
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

    await workspacesRepo.write(scoped.userId, workspace);

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
  const scoped = await resolveUserId();
  if (!scoped.ok) return scoped.response;

  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get('challengeId');

  try {
    if (challengeId) {
      if (!SAFE_PATH_SEGMENT.test(challengeId)) {
        return NextResponse.json({ error: 'Invalid challengeId' }, { status: 400 });
      }
      await workspacesRepo.remove(scoped.userId, challengeId);
      log.debug('Deleted workspace', { challengeId });
    } else {
      // Delete all workspaces for this user only — never touch other users.
      await workspacesRepo.removeAll(scoped.userId);
      log.debug('Deleted all workspaces for user');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('DELETE /api/workspace/storage failed', { challengeId, error });
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
