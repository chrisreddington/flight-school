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
import { WORKSPACES_DIR, toFileMetadata } from './legacy-tree';
import type { ChallengeWorkspace, WorkspaceMetadata, WorkspaceStoreInterface } from './types';
import { MAX_WORKSPACE_SIZE_BYTES } from './types';

const log = logger.withTag('WorkspaceStore');

// =============================================================================
// Utility Functions
// =============================================================================

/** Returns the UTF-8 byte length of `text`. */
function getByteSize(text: string): number {
  return new Blob([text]).size;
}

// =============================================================================
// ServerWorkspaceStore Class
// =============================================================================

/**
 * Server-backed implementation of WorkspaceStoreInterface using file storage.
 *
 * @remarks
 * Each workspace lives under `users/{userId}/workspaces/{challengeId}/` with
 * real files for content and a `_workspace.json` metadata sidecar.
 */
class ServerWorkspaceStore implements WorkspaceStoreInterface {
  /**
   * In-flight request dedup. React strict-mode (and any other rapid
   * remount) can fire the same workspace load/save/delete twice within a
   * single frame. Without this guard the server sees the same DELETE or
   * POST twice in a row (visible in OTel traces as two sibling client
   * spans 1ms apart). Keyed by `${method}:${challengeId}` so unrelated
   * operations don't collide.
   */
  private readonly inflight = new Map<string, Promise<unknown>>();

  private dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = fn().finally(() => {
      // Only clear if still ours — guards against a later identical key
      // having already replaced the entry.
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key);
      }
    });
    this.inflight.set(key, promise);
    return promise;
  }

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
        { throwOnError: false },
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

    return this.dedupe(`get:${challengeId}`, async () => {
      try {
        const workspace = await apiGet<ChallengeWorkspace>(
          `/api/workspace/storage?challengeId=${encodeURIComponent(challengeId)}`,
          { throwOnError: false },
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
    });
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
          sizeMB: (byteSize / 1024 / 1024).toFixed(2),
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

    await this.dedupe(`del:${challengeId}`, async () => {
      try {
        await apiDelete<void>(`/api/workspace/storage?challengeId=${encodeURIComponent(challengeId)}`);
      } catch (error) {
        log.error('Failed to delete workspace', { challengeId, error });
      }
    });
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
      const listResponse = await apiGet<{ challengeIds: string[] }>('/api/workspace/storage/list', {
        throwOnError: false,
      });
      return listResponse?.challengeIds ?? [];
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

export { WORKSPACES_DIR, toFileMetadata };
