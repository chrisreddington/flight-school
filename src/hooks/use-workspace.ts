/**
 * useWorkspace Hook
 *
 * React hook for managing challenge workspace state with auto-save.
 * Provides file CRUD operations with debounced server-side persistence.
 *
 * @remarks
 * This hook uses server-side storage in the .data folder for persistence.
 *
 * @example
 * ```typescript
 * const {
 *   files,
 *   activeFile,
 *   setActiveFile,
 *   updateFileContent,
 *   addFile,
 *   deleteFile,
 *   renameFile,
 *   isSaving,
 *   hasUnsavedChanges,
 *   saveNow,
 * } = useWorkspace('challenge-123', challenge);
 * ```
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { now } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';

import type { ChallengeDef } from '@/lib/copilot/types';
import {
    AUTO_SAVE_DELAY_MS,
    createEmptyFile,
    CURRENT_WORKSPACE_SCHEMA_VERSION,
    getWorkspaceTemplate,
    MAX_FILES_PER_WORKSPACE,
    workspaceStore,
    type ChallengeWorkspace,
    type WorkspaceFile,
} from '@/lib/workspace';

const log = logger.withTag('useWorkspace');

// =============================================================================
// Types
// =============================================================================

/** State returned by useWorkspace */
export interface UseWorkspaceState {
  /** All files in the workspace */
  files: WorkspaceFile[];
  /** Currently active file */
  activeFile: WorkspaceFile | null;
  /** ID of the active file */
  activeFileId: string;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Error from last save attempt */
  saveError: string | null;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
}

/** Actions provided by useWorkspace */
export interface UseWorkspaceActions {
  /** Set the active file by ID */
  setActiveFile: (fileId: string) => void;
  /** Update the content of a file */
  updateFileContent: (fileId: string, content: string) => void;
  /** Add a new file to the workspace */
  addFile: (name?: string) => WorkspaceFile | null;
  /** Delete a file from the workspace */
  deleteFile: (fileId: string) => boolean;
  /** Rename a file */
  renameFile: (fileId: string, newName: string) => boolean;
  /** Force save immediately */
  saveNow: () => void;
  /** Reset workspace to template */
  reset: () => void;
}

/** Return type of useWorkspace hook */
export type UseWorkspaceReturn = UseWorkspaceState & UseWorkspaceActions;

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing challenge workspace state with auto-save.
 *
 * @param challengeId - Unique ID for the challenge
 * @param challenge - Challenge definition (used for template generation)
 * @returns Workspace state and actions
 */
export function useWorkspace(
  challengeId: string,
  challenge: ChallengeDef
): UseWorkspaceReturn {
  // Workspace state
  const [workspace, setWorkspace] = useState<ChallengeWorkspace | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Refs for debounce
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWorkspaceRef = useRef<ChallengeWorkspace | null>(null);

  // ==========================================================================
  // Load workspace on mount
  // ==========================================================================

  useEffect(() => {
    let mounted = true;

    // Async loader function
    async function loadWorkspace() {
      try {
        // Try to load existing workspace
        const existing = await workspaceStore.getWorkspace(challengeId);
        
        if (!mounted) return;

        if (existing) {
          setWorkspace(existing);
        } else {
          // Create new workspace from template
          const templateFiles = getWorkspaceTemplate(challenge);
          const timestamp = now();
          const newWorkspace: ChallengeWorkspace = {
            version: CURRENT_WORKSPACE_SCHEMA_VERSION,
            challengeId,
            files: templateFiles,
            activeFileId: templateFiles[0]?.id ?? '',
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          setWorkspace(newWorkspace);
          // Save immediately
          await workspaceStore.saveWorkspace(newWorkspace);
        }
      } catch (error) {
        log.error('Failed to load workspace', { challengeId, error });
        // Create new workspace on error
        const templateFiles = getWorkspaceTemplate(challenge);
        const timestamp = now();
        const newWorkspace: ChallengeWorkspace = {
          version: CURRENT_WORKSPACE_SCHEMA_VERSION,
          challengeId,
          files: templateFiles,
          activeFileId: templateFiles[0]?.id ?? '',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (mounted) {
          setWorkspace(newWorkspace);
        }
      }
    }

    loadWorkspace();

    // Cleanup on unmount
    return () => {
      mounted = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Save any pending changes
        if (pendingWorkspaceRef.current) {
          workspaceStore.saveWorkspace(pendingWorkspaceRef.current);
        }
      }
    };
    // NOTE: Intentionally limited to `challengeId` - this effect manages workspace
    // lifecycle for a specific challenge. Including `challenge` would cause the
    // workspace to reload whenever challenge metadata changes (e.g., title update),
    // losing user's work. The workspace template is only needed on initial creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  // ==========================================================================
  // Save functions
  // ==========================================================================

  /** Schedules a debounced save. */
  const scheduleSave = useCallback((ws: ChallengeWorkspace) => {
    pendingWorkspaceRef.current = ws;
    setHasUnsavedChanges(true);

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule new save
    saveTimeoutRef.current = setTimeout(async () => {
      if (pendingWorkspaceRef.current) {
        setIsSaving(true);
        try {
          await workspaceStore.saveWorkspace(pendingWorkspaceRef.current);
          setSaveError(null);
          setHasUnsavedChanges(false);
        } catch (error) {
          setSaveError(error instanceof Error ? error.message : 'Failed to save');
        } finally {
          setIsSaving(false);
          pendingWorkspaceRef.current = null;
        }
      }
    }, AUTO_SAVE_DELAY_MS);
  }, []);

  /** Forces an immediate save. */
  const saveNow = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const toSave = pendingWorkspaceRef.current || workspace;
    if (toSave) {
      setIsSaving(true);
      try {
        await workspaceStore.saveWorkspace(toSave);
        setSaveError(null);
        setHasUnsavedChanges(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Failed to save');
      } finally {
        setIsSaving(false);
        pendingWorkspaceRef.current = null;
      }
    }
  }, [workspace]);

  // ==========================================================================
  // File operations
  // ==========================================================================

  /** Sets the active file. */
  const setActiveFile = useCallback((fileId: string) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      if (!prev.files.some((f) => f.id === fileId)) return prev;
      const updated = { ...prev, activeFileId: fileId };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  /** Updates file content. */
  const updateFileContent = useCallback((fileId: string, content: string) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        files: prev.files.map((f) =>
          f.id === fileId
            ? { ...f, content, updatedAt: now() }
            : f
        ),
      };
      scheduleSave(updated);
      return updated;
    });
  }, [scheduleSave]);

  /** Adds a new file. */
  const addFile = useCallback((name?: string): WorkspaceFile | null => {
    let newFile: WorkspaceFile | null = null;

    setWorkspace((prev) => {
      if (!prev) return prev;
      
      // Check file limit
      if (prev.files.length >= MAX_FILES_PER_WORKSPACE) {
        return prev;
      }

      // Generate default name if not provided
      const extension = prev.files[0]?.name.split('.').pop() ?? 'ts';
      const baseName = name ?? `untitled-${prev.files.length + 1}`;
      const fileName = baseName.includes('.') ? baseName : `${baseName}.${extension}`;
      const language = prev.files[0]?.language ?? 'typescript';

      newFile = createEmptyFile(fileName, language);
      
      const updated = {
        ...prev,
        files: [...prev.files, newFile],
        activeFileId: newFile.id,
      };
      scheduleSave(updated);
      return updated;
    });

    return newFile;
  }, [scheduleSave]);

  /** Deletes a file. */
  const deleteFile = useCallback((fileId: string): boolean => {
    let deleted = false;

    setWorkspace((prev) => {
      if (!prev) return prev;
      
      // Don't allow deleting the last file
      if (prev.files.length <= 1) {
        return prev;
      }

      const fileIndex = prev.files.findIndex((f) => f.id === fileId);
      if (fileIndex === -1) return prev;

      deleted = true;
      const newFiles = prev.files.filter((f) => f.id !== fileId);
      
      // Update active file if needed
      let newActiveId = prev.activeFileId;
      if (prev.activeFileId === fileId) {
        // Select adjacent file
        const newIndex = Math.min(fileIndex, newFiles.length - 1);
        newActiveId = newFiles[newIndex]?.id ?? newFiles[0]?.id ?? '';
      }

      const updated = {
        ...prev,
        files: newFiles,
        activeFileId: newActiveId,
      };
      scheduleSave(updated);
      return updated;
    });

    return deleted;
  }, [scheduleSave]);

  /** Renames a file. */
  const renameFile = useCallback((fileId: string, newName: string): boolean => {
    let renamed = false;

    setWorkspace((prev) => {
      if (!prev) return prev;
      
      // Check for duplicate names
      if (prev.files.some((f) => f.id !== fileId && f.name === newName)) {
        return prev;
      }

      const fileExists = prev.files.some((f) => f.id === fileId);
      if (!fileExists) return prev;

      renamed = true;
      const updated = {
        ...prev,
        files: prev.files.map((f) =>
          f.id === fileId
            ? { ...f, name: newName, updatedAt: now() }
            : f
        ),
      };
      scheduleSave(updated);
      return updated;
    });

    return renamed;
  }, [scheduleSave]);

  /** Resets workspace to template. */
  const reset = useCallback(async () => {
    // Cancel pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    pendingWorkspaceRef.current = null;

    // Create fresh workspace
    const templateFiles = getWorkspaceTemplate(challenge);
    const timestamp = now();
    const newWorkspace: ChallengeWorkspace = {
      version: CURRENT_WORKSPACE_SCHEMA_VERSION,
      challengeId,
      files: templateFiles,
      activeFileId: templateFiles[0]?.id ?? '',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    
    setWorkspace(newWorkspace);
    setHasUnsavedChanges(false);
    setSaveError(null);
    await workspaceStore.saveWorkspace(newWorkspace);
  }, [challengeId, challenge]);

  // ==========================================================================
  // Computed values
  // ==========================================================================

  const files = workspace?.files ?? [];
  const activeFileId = workspace?.activeFileId ?? '';
  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  return {
    // State
    files,
    activeFile,
    activeFileId,
    isSaving,
    saveError,
    hasUnsavedChanges,
    // Actions
    setActiveFile,
    updateFileContent,
    addFile,
    deleteFile,
    renameFile,
    saveNow,
    reset,
  };
}
