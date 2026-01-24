/**
 * Workspace Storage
 *
 * Provides persistent file-based storage for challenge workspaces.
 * Each workspace is stored as a directory with actual files + metadata sidecar.
 *
 * @remarks
 * Storage structure:
 * ```
 * .data/workspaces/
 *   {challengeId}/
 *     _workspace.json    # metadata (activeFileId, timestamps, file metadata)
 *     solution.ts        # actual file content
 *     solution.test.ts   # actual file content
 * ```
 *
 * @example
 * ```typescript
 * import { workspaceStore } from '@/lib/workspace';
 *
 * // Get workspace for a challenge
 * const workspace = await workspaceStore.getWorkspace('challenge-123');
 *
 * // Save workspace
 * await workspaceStore.saveWorkspace(workspace);
 *
 * // List all stored workspaces
 * const challengeIds = await workspaceStore.listWorkspaces();
 * ```
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import type {
    ChallengeWorkspace,
    WorkspaceFile,
    WorkspaceFileMetadata,
    WorkspaceMetadata,
    WorkspaceStoreInterface,
} from './types';
import {
    MAX_WORKSPACE_SIZE_BYTES,
} from './types';

const log = logger.withTag('WorkspaceStore');

// =============================================================================
// Constants
// =============================================================================

const WORKSPACES_DIR = 'workspaces';
const METADATA_FILENAME = '_workspace.json';

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Calculates the size of a string in bytes (UTF-8).
 */
function getByteSize(str: string): number {
  return new Blob([str]).size;
}

/**
 * Converts a WorkspaceFile to metadata (strips content).
 */
function toFileMetadata(file: WorkspaceFile): WorkspaceFileMetadata {
  return {
    id: file.id,
    name: file.name,
    language: file.language,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

/**
 * Converts metadata + content back to a WorkspaceFile.
 */
function toWorkspaceFile(meta: WorkspaceFileMetadata, content: string): WorkspaceFile {
  return {
    ...meta,
    content,
  };
}

// =============================================================================
// ServerWorkspaceStore Class
// =============================================================================

/**
 * Server-backed implementation of WorkspaceStoreInterface using file-based storage.
 *
 * @remarks
 * Each workspace is stored in its own directory under .data/workspaces/{challengeId}/
 * with actual files for content and a _workspace.json metadata sidecar.
 */
class ServerWorkspaceStore implements WorkspaceStoreInterface {
  /**
   * Gets the workspace directory path for a challenge.
   */
  private getWorkspaceDir(challengeId: string): string {
    return `${WORKSPACES_DIR}/${challengeId}`;
  }

  /**
   * Reads workspace metadata from the server API.
   */
  private async getMetadata(challengeId: string): Promise<WorkspaceMetadata | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const metadata = await apiGet<WorkspaceMetadata>(
        `/api/workspace/storage?challengeId=${encodeURIComponent(challengeId)}&metadataOnly=true`,
        { throwOnError: false }
      );
      return metadata;
    } catch (error) {
      log.error('Failed to load workspace metadata', { challengeId, error });
      return null;
    }
  }

  /**
   * Reads and parses workspace data for a specific challenge.
   *
   * @param challengeId - Challenge ID to retrieve workspace for
   * @returns Parsed workspace or null if not found/invalid
   */
  async getWorkspace(challengeId: string): Promise<ChallengeWorkspace | null> {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      const workspace = await apiGet<ChallengeWorkspace>(
        `/api/workspace/storage?challengeId=${encodeURIComponent(challengeId)}`,
        { throwOnError: false }
      );

      if (!workspace) {
        return null;
      }

      // Validate workspace belongs to correct challenge
      if (workspace.challengeId !== challengeId) {
        log.warn('Challenge ID mismatch, clearing', { challengeId });
        await this.deleteWorkspace(challengeId);
        return null;
      }

      // Check size warning
      const serialized = JSON.stringify(workspace);
      if (getByteSize(serialized) > MAX_WORKSPACE_SIZE_BYTES) {
        log.warn('Workspace exceeds size limit', { challengeId });
      }

      return workspace;
    } catch (error) {
      log.error('Failed to parse workspace', { challengeId, error });
      return null;
    }
  }

  /**
   * Saves a workspace to server storage.
   *
   * @param workspace - Workspace to save
   * @throws Logs warning if workspace exceeds size limit
   */
  async saveWorkspace(workspace: ChallengeWorkspace): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      // Update workspace timestamp
      const updated: ChallengeWorkspace = {
        ...workspace,
        updatedAt: now(),
      };

      const serialized = JSON.stringify(updated);
      const byteSize = getByteSize(serialized);

      // Warn if approaching storage limit
      if (byteSize > MAX_WORKSPACE_SIZE_BYTES) {
        log.warn('Workspace is large, consider exporting', { 
          challengeId: workspace.challengeId, 
          sizeMB: (byteSize / 1024 / 1024).toFixed(2) 
        });
      }

      await apiPost<void>('/api/workspace/storage', updated);
    } catch (error) {
      log.error('Failed to save workspace', { challengeId: workspace.challengeId, error });
      throw error;
    }
  }

  /**
   * Deletes a workspace from server storage.
   *
   * @param challengeId - Challenge ID to delete workspace for
   */
  async deleteWorkspace(challengeId: string): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      await apiDelete<void>(`/api/workspace/storage?challengeId=${encodeURIComponent(challengeId)}`);
    } catch (error) {
      log.error('Failed to delete workspace', { challengeId, error });
    }
  }

  /**
   * Lists all challenge IDs that have stored workspaces.
   *
   * @returns Array of challenge IDs
   */
  async listWorkspaces(): Promise<string[]> {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const data = await apiGet<{ challengeIds: string[] }>('/api/workspace/storage/list', { throwOnError: false });
      return data?.challengeIds ?? [];
    } catch (error) {
      log.error('Failed to list workspaces', { error });
      return [];
    }
  }

  /**
   * Clears all workspace data from server storage.
   */
  async clearAll(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      await apiDelete<void>('/api/workspace/storage');
    } catch (error) {
      log.error('Failed to clear all workspaces', { error });
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton workspace store instance.
 *
 * Use this for all workspace persistence operations.
 */
export const workspaceStore = new ServerWorkspaceStore();

// =============================================================================
// Server-Side Utilities (for API routes)
// =============================================================================

export {
  WORKSPACES_DIR,
  METADATA_FILENAME,
  toFileMetadata,
  toWorkspaceFile,
};
