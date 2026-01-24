/**
 * Workspace Storage API Route
 * 
 * Server-side file-based persistence for challenge workspaces.
 * 
 * Storage structure:
 * ```
 * .data/workspaces/
 *   {challengeId}/
 *     _workspace.json    # metadata only
 *     solution.ts        # actual file content
 * ```
 * 
 * Endpoints:
 * - GET ?challengeId=X           - Read workspace (full or metadata only)
 * - POST                         - Save workspace
 * - DELETE ?challengeId=X        - Delete specific workspace
 * - DELETE (no params)           - Delete all workspaces
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  readFile, 
  writeFile, 
  deleteFile, 
  deleteDir, 
  listFiles,
  ensureDir 
} from '@/lib/storage/utils';
import type { ChallengeWorkspace, WorkspaceFile, WorkspaceMetadata } from '@/lib/workspace/types';
import { 
  WORKSPACES_DIR, 
  METADATA_FILENAME, 
  toFileMetadata, 
  toWorkspaceFile 
} from '@/lib/workspace/storage';
import { logger } from '@/lib/logger';

const log = logger.withTag('Workspace Storage API');

// =============================================================================
// Utility Functions
// =============================================================================

function getWorkspaceDir(challengeId: string): string {
  return `${WORKSPACES_DIR}/${challengeId}`;
}

// =============================================================================
// GET: Read workspace
// =============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get('challengeId');
  const metadataOnly = searchParams.get('metadataOnly') === 'true';

  if (!challengeId) {
    return NextResponse.json({ error: 'challengeId required' }, { status: 400 });
  }

  try {
    const workspaceDir = getWorkspaceDir(challengeId);
    
    // Read metadata
    const metadataJson = await readFile(workspaceDir, METADATA_FILENAME);
    if (!metadataJson) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const metadata: WorkspaceMetadata = JSON.parse(metadataJson);

    if (metadataOnly) {
      return NextResponse.json(metadata);
    }

    // Read file contents
    const files: WorkspaceFile[] = await Promise.all(
      metadata.files.map(async (fileMeta) => {
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
  try {
    const workspace: ChallengeWorkspace = await request.json();
    
    if (!workspace.challengeId || !workspace.files) {
      return NextResponse.json({ error: 'Invalid workspace data' }, { status: 400 });
    }

    const workspaceDir = getWorkspaceDir(workspace.challengeId);
    
    // Ensure directory exists
    await ensureDir(workspaceDir);

    // Get existing files to detect deletions
    const existingFiles = await listFiles(workspaceDir);
    const newFileNames = new Set(workspace.files.map(f => f.name));
    newFileNames.add(METADATA_FILENAME); // Don't delete metadata

    // Delete files that no longer exist
    for (const existingFile of existingFiles) {
      if (!newFileNames.has(existingFile)) {
        await deleteFile(workspaceDir, existingFile);
      }
    }

    // Write each file
    await Promise.all(
      workspace.files.map(file => writeFile(workspaceDir, file.name, file.content))
    );

    // Write metadata (without file content)
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
  const { searchParams } = new URL(request.url);
  const challengeId = searchParams.get('challengeId');

  try {
    if (challengeId) {
      // Delete specific workspace
      const workspaceDir = getWorkspaceDir(challengeId);
      await deleteDir(workspaceDir);
      log.debug('Deleted workspace', { challengeId });
    } else {
      // Delete all workspaces
      await deleteDir(WORKSPACES_DIR);
      log.debug('Deleted all workspaces');
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('DELETE /api/workspace/storage failed', { challengeId, error });
    return NextResponse.json({ error: 'Failed to delete workspace' }, { status: 500 });
  }
}
