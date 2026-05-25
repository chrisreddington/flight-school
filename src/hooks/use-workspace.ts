'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ChallengeDef } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import {
  AUTO_SAVE_DELAY_MS,
  createEmptyFile,
  createWorkspaceFromTemplate,
  MAX_FILES_PER_WORKSPACE,
  workspaceStore,
  type ChallengeWorkspace,
  type WorkspaceFile,
} from '@/lib/workspace';

const log = logger.withTag('useWorkspace');

interface UseWorkspaceState {
  files: WorkspaceFile[];
  activeFile: WorkspaceFile | null;
  activeFileId: string;
  isSaving: boolean;
  saveError: string | null;
  hasUnsavedChanges: boolean;
}

interface UseWorkspaceActions {
  setActiveFile: (fileId: string) => void;
  updateFileContent: (fileId: string, content: string) => void;
  addFile: (name?: string) => WorkspaceFile | null;
  deleteFile: (fileId: string) => boolean;
  renameFile: (fileId: string, newName: string) => boolean;
  saveNow: () => void;
  reset: () => void;
}

export type UseWorkspaceReturn = UseWorkspaceState & UseWorkspaceActions;

/**
 * Manages challenge workspace state with debounced auto-save to server storage.
 */
export function useWorkspace(challengeId: string, challenge: ChallengeDef): UseWorkspaceReturn {
  const [workspace, setWorkspace] = useState<ChallengeWorkspace | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWorkspaceRef = useRef<ChallengeWorkspace | null>(null);

  const persistWorkspace = useCallback(async (ws: ChallengeWorkspace) => {
    setIsSaving(true);
    try {
      await workspaceStore.saveWorkspace(ws);
      setSaveError(null);
      setHasUnsavedChanges(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
    } finally {
      setIsSaving(false);
      pendingWorkspaceRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadWorkspace() {
      let initial: ChallengeWorkspace;
      try {
        const existing = await workspaceStore.getWorkspace(challengeId);
        if (!mounted) return;
        if (existing) {
          setWorkspace(existing);
          return;
        }
        initial = createWorkspaceFromTemplate(challengeId, challenge);
        await workspaceStore.saveWorkspace(initial);
      } catch (error) {
        log.error('Failed to load workspace', { challengeId, error });
        initial = createWorkspaceFromTemplate(challengeId, challenge);
      }
      if (mounted) setWorkspace(initial);
    }

    loadWorkspace();

    return () => {
      mounted = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        if (pendingWorkspaceRef.current) {
          workspaceStore.saveWorkspace(pendingWorkspaceRef.current);
        }
      }
    };
    // NOTE: Intentionally limited to `challengeId`. Including `challenge`
    // would reload (and lose user work) whenever challenge metadata changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challengeId]);

  const scheduleSave = useCallback(
    (ws: ChallengeWorkspace) => {
      pendingWorkspaceRef.current = ws;
      setHasUnsavedChanges(true);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      saveTimeoutRef.current = setTimeout(() => {
        if (pendingWorkspaceRef.current) {
          persistWorkspace(pendingWorkspaceRef.current);
        }
      }, AUTO_SAVE_DELAY_MS);
    },
    [persistWorkspace],
  );

  const saveNow = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    const toSave = pendingWorkspaceRef.current ?? workspace;
    if (toSave) await persistWorkspace(toSave);
  }, [workspace, persistWorkspace]);

  const setActiveFile = useCallback(
    (fileId: string) => {
      setWorkspace((prev) => {
        if (!prev || !prev.files.some((f) => f.id === fileId)) return prev;
        const updated = { ...prev, activeFileId: fileId };
        scheduleSave(updated);
        return updated;
      });
    },
    [scheduleSave],
  );

  const updateFileContent = useCallback(
    (fileId: string, content: string) => {
      setWorkspace((prev) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          files: prev.files.map((f) => (f.id === fileId ? { ...f, content, updatedAt: now() } : f)),
        };
        scheduleSave(updated);
        return updated;
      });
    },
    [scheduleSave],
  );

  const addFile = useCallback(
    (name?: string): WorkspaceFile | null => {
      let newFile: WorkspaceFile | null = null;

      setWorkspace((prev) => {
        if (!prev || prev.files.length >= MAX_FILES_PER_WORKSPACE) return prev;

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
    },
    [scheduleSave],
  );

  const deleteFile = useCallback(
    (fileId: string): boolean => {
      let deleted = false;

      setWorkspace((prev) => {
        if (!prev || prev.files.length <= 1) return prev;
        const fileIndex = prev.files.findIndex((f) => f.id === fileId);
        if (fileIndex === -1) return prev;

        deleted = true;
        const newFiles = prev.files.filter((f) => f.id !== fileId);
        const newActiveId =
          prev.activeFileId === fileId
            ? (newFiles[Math.min(fileIndex, newFiles.length - 1)]?.id ?? newFiles[0]?.id ?? '')
            : prev.activeFileId;

        const updated = { ...prev, files: newFiles, activeFileId: newActiveId };
        scheduleSave(updated);
        return updated;
      });

      return deleted;
    },
    [scheduleSave],
  );

  const renameFile = useCallback(
    (fileId: string, newName: string): boolean => {
      let renamed = false;

      setWorkspace((prev) => {
        if (!prev) return prev;
        if (prev.files.some((f) => f.id !== fileId && f.name === newName)) return prev;
        if (!prev.files.some((f) => f.id === fileId)) return prev;

        renamed = true;
        const updated = {
          ...prev,
          files: prev.files.map((f) => (f.id === fileId ? { ...f, name: newName, updatedAt: now() } : f)),
        };
        scheduleSave(updated);
        return updated;
      });

      return renamed;
    },
    [scheduleSave],
  );

  const reset = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    pendingWorkspaceRef.current = null;

    const fresh = createWorkspaceFromTemplate(challengeId, challenge);
    setWorkspace(fresh);
    setHasUnsavedChanges(false);
    setSaveError(null);
    await workspaceStore.saveWorkspace(fresh);
  }, [challengeId, challenge]);

  const files = workspace?.files ?? [];
  const activeFileId = workspace?.activeFileId ?? '';
  const activeFile = files.find((f) => f.id === activeFileId) ?? null;

  return {
    files,
    activeFile,
    activeFileId,
    isSaving,
    saveError,
    hasUnsavedChanges,
    setActiveFile,
    updateFileContent,
    addFile,
    deleteFile,
    renameFile,
    saveNow,
    reset,
  };
}
