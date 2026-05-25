/**
 * useThreads Hook
 *
 * React hook for managing chat threads with server-side JSON persistence.
 * Provides CRUD operations and state management for multi-thread chat.
 *
 * @example
 * ```typescript
 * const { threads, activeThread, createThread, selectThread } = useThreads();
 *
 * // Create a new thread
 * const thread = await createThread({ title: 'Learning React Hooks' });
 *
 * // Switch between threads
 * selectThread(thread.id);
 * ```
 */

'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { logger } from '@/lib/logger';
import { threadStore, type CreateThreadOptions, type Message, type Thread, type ThreadContext } from '@/lib/threads';
import { now, nowMs } from '@/lib/utils/date-utils';

const log = logger.withTag('useThreads');

const THREADS_KEY = ['threads'] as const;

/** State returned by the useThreads hook */
interface UseThreadsState {
  /** All threads, ordered by most recently updated */
  threads: Thread[];
  /** Currently active thread (null if none selected) */
  activeThread: Thread | null;
  /** ID of the active thread */
  activeThreadId: string | null;
  /** Whether the hook is loading from storage */
  isLoading: boolean;
}

/** Actions provided by the useThreads hook */
interface UseThreadsActions {
  /** Create a new thread and optionally make it active */
  createThread: (options?: CreateThreadOptions, makeActive?: boolean) => Promise<Thread>;
  /** Select a thread by ID */
  selectThread: (id: string) => void;
  /** Delete a thread by ID */
  deleteThread: (id: string) => Promise<void>;
  /** Rename a thread */
  renameThread: (id: string, title: string) => Promise<void>;
  /** Update thread context (repos, learning focus) */
  updateContext: (id: string, context: Partial<ThreadContext>) => Promise<void>;
  /** Add a message to the active thread */
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => Promise<void>;
  /** Update the active thread (or a specific thread by ID) with new messages */
  updateActiveThread: (update: Partial<Thread>, targetThreadId?: string) => Promise<void>;
  /** Refresh threads from storage */
  refresh: () => Promise<void>;
}

/** Return type of the useThreads hook */
export type UseThreadsReturn = UseThreadsState & UseThreadsActions;

/**
 * Hook for managing chat threads.
 *
 * @remarks
 * Backed by TanStack Query: the thread list lives in the QueryClient cache
 * under `['threads']` and every mutation invalidates that key to trigger a
 * refetch. Local `selectedThreadId` state captures the user's selection.
 *
 * Error contract preserved from the pre-TanStack version:
 * - `createThread` re-throws (callers `await` and expect rejections).
 * - All other mutations swallow + log (callers expect `.resolves.toBeUndefined()`).
 *
 * `addMessage` and `updateActiveThread` read the target thread fresh from
 * `threadStore` (not from the TanStack cache) to avoid a stale-cache race
 * during in-flight invalidation when callers chain rename→update.
 *
 * No `useMemo` / `useCallback` here on purpose — the React Compiler handles
 * memoization, and a hand-rolled `useMemo` over `threads.find(...)` was
 * caught returning stale results in tests. See repo guideline in
 * `.github/copilot-instructions.md` (Next 16 / React 19.2 build flags).
 */
export function useThreads(): UseThreadsReturn {
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const threadsQuery = useQuery({
    queryKey: THREADS_KEY,
    queryFn: () => threadStore.getAll(),
  });

  const threads = threadsQuery.data ?? [];
  const isLoading = threadsQuery.isPending;

  const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null;

  const activeThread = activeThreadId ? (threads.find((thread) => thread.id === activeThreadId) ?? null) : null;

  const invalidateThreads = () => queryClient.invalidateQueries({ queryKey: THREADS_KEY });

  const createMutation = useMutation({
    mutationFn: (options?: CreateThreadOptions) => threadStore.create(options),
    onSuccess: () => invalidateThreads(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => threadStore.delete(id),
    onSuccess: async (_void, deletedId) => {
      if (selectedThreadId === deletedId) {
        // Pre-invalidation cache still includes the deleted thread; filter it
        // out manually so the next selection is deterministic.
        const cachedThreads = queryClient.getQueryData<Thread[]>(THREADS_KEY) ?? [];
        const remaining = cachedThreads.filter((thread) => thread.id !== deletedId);
        setSelectedThreadId(remaining[0]?.id ?? null);
      }
      await invalidateThreads();
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => threadStore.rename(id, title),
    onSuccess: (updated) => {
      if (updated) return invalidateThreads();
      return undefined;
    },
  });

  const updateContextMutation = useMutation({
    mutationFn: ({ id, context }: { id: string; context: Partial<ThreadContext> }) =>
      threadStore.updateContext(id, context),
    onSuccess: (updated) => {
      if (updated) return invalidateThreads();
      return undefined;
    },
  });

  const updateThreadMutation = useMutation({
    mutationFn: (updated: Thread) => threadStore.update(updated),
    onSuccess: () => invalidateThreads(),
  });

  const createThread = async (options?: CreateThreadOptions, makeActive = true): Promise<Thread> => {
    try {
      const thread = await createMutation.mutateAsync(options);
      log.debug('Created thread', { id: thread.id, title: thread.title, options });
      if (makeActive) {
        setSelectedThreadId(thread.id);
      }
      return thread;
    } catch (error) {
      log.error('Failed to create thread', { error });
      throw error;
    }
  };

  const selectThread = (id: string) => {
    setSelectedThreadId(id);
  };

  const deleteThread = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      log.error('Failed to delete thread', { error });
    }
  };

  const renameThread = async (id: string, title: string) => {
    try {
      await renameMutation.mutateAsync({ id, title });
    } catch (error) {
      log.error('Failed to rename thread', { error });
    }
  };

  const updateContext = async (id: string, context: Partial<ThreadContext>) => {
    try {
      await updateContextMutation.mutateAsync({ id, context });
    } catch (error) {
      log.error('Failed to update thread context', { error });
    }
  };

  const addMessage = async (message: Omit<Message, 'id' | 'timestamp'>) => {
    try {
      if (!activeThreadId) return;

      // Single source of truth: avoids stale TQ cache during in-flight
      // invalidation when the caller has just renamed or otherwise mutated
      // this same thread moments before.
      const thread = await threadStore.getById(activeThreadId);
      if (!thread) return;

      const newMessage: Message = {
        ...message,
        id: `msg-${nowMs()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: now(),
      };

      const updated: Thread = {
        ...thread,
        messages: [...thread.messages, newMessage],
        updatedAt: now(),
      };

      await updateThreadMutation.mutateAsync(updated);
    } catch (error) {
      log.error('Failed to add message to thread', { error });
    }
  };

  const updateActiveThread = async (update: Partial<Thread>, targetThreadId?: string) => {
    try {
      const threadId = targetThreadId ?? activeThreadId;
      if (!threadId) return;

      // Fresh server read — see addMessage comment.
      const thread = await threadStore.getById(threadId);
      if (!thread) return;

      const updated: Thread = {
        ...thread,
        ...update,
        id: thread.id, // Prevent ID override
        updatedAt: now(),
      };

      await updateThreadMutation.mutateAsync(updated);
    } catch (error) {
      log.error('Failed to update active thread', { error });
    }
  };

  const refresh = async () => {
    await threadsQuery.refetch();
  };

  return {
    threads,
    activeThread,
    activeThreadId,
    isLoading,
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    updateContext,
    addMessage,
    updateActiveThread,
    refresh,
  };
}
