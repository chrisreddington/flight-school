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

import { logger } from '@/lib/logger';
import { now, nowMs } from '@/lib/utils/date-utils';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
    threadStore,
    type CreateThreadOptions,
    type Message,
    type Thread,
    type ThreadContext,
} from '@/lib/threads';

const log = logger.withTag('useThreads');

/** State returned by the useThreads hook */
export interface UseThreadsState {
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
export interface UseThreadsActions {
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
 * Provides comprehensive thread management including:
 * - Creating, selecting, deleting threads
 * - Renaming threads
 * - Updating thread context (repos, learning focus)
 * - Adding messages to threads
 * - Automatic server-side JSON persistence
 *
 * @returns Thread state and actions
 */
export function useThreads(): UseThreadsReturn {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null;

  // Compute active thread from ID
  const activeThread = useMemo(() => {
    if (!activeThreadId) return null;
    return threads.find((t) => t.id === activeThreadId) ?? null;
  }, [threads, activeThreadId]);

  // Load threads from storage
  const loadThreads = useCallback(async () => {
    try {
      const loaded = await threadStore.getAll();
      setThreads(loaded);
    } catch (error) {
      log.error('Failed to load threads', { error });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  // Refresh threads from storage
  const refresh = useCallback(async () => {
    await loadThreads();
  }, [loadThreads]);

  // Create a new thread
  const createThread = useCallback(async (options?: CreateThreadOptions, makeActive = true): Promise<Thread> => {
    const thread = await threadStore.create(options);
    log.debug('Created thread', { id: thread.id, title: thread.title, options });
    if (makeActive) {
      setSelectedThreadId(thread.id);
    }
    await loadThreads();
    return thread;
  }, [loadThreads]);

  // Select a thread by ID
  const selectThread = useCallback((id: string) => {
    setSelectedThreadId(id);
  }, []);

  // Delete a thread by ID
  const deleteThread = useCallback(async (id: string) => {
    await threadStore.delete(id);
    if (activeThreadId === id) {
      const remaining = await threadStore.getAll();
      setSelectedThreadId(remaining[0]?.id ?? null);
    }
    await loadThreads();
  }, [activeThreadId, loadThreads]);

  // Rename a thread
  const renameThread = useCallback(async (id: string, title: string) => {
    const updated = await threadStore.rename(id, title);
    if (updated) {
      await loadThreads();
    }
  }, [loadThreads]);

  // Update thread context
  const updateContext = useCallback(async (id: string, context: Partial<ThreadContext>) => {
    const updated = await threadStore.updateContext(id, context);
    if (updated) {
      await loadThreads();
    }
  }, [loadThreads]);

  // Add a message to the active thread
  const addMessage = useCallback(async (message: Omit<Message, 'id' | 'timestamp'>) => {
    if (!activeThreadId) return;
    
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

    await threadStore.update(updated);
    await loadThreads();
  }, [activeThreadId, loadThreads]);

  // Update the active thread (or a specific thread by ID)
  const updateActiveThread = useCallback(async (update: Partial<Thread>, targetThreadId?: string) => {
    const threadId = targetThreadId ?? activeThreadId;
    if (!threadId) return;
    
    // Get fresh thread data from storage to avoid stale React state issues
    // This is critical when rename happens before message update
    const thread = await threadStore.getById(threadId);
    if (!thread) return;

    const updated: Thread = {
      ...thread,
      ...update,
      id: thread.id, // Prevent ID override
      updatedAt: now(),
    };

    await threadStore.update(updated);
    await loadThreads();
  }, [activeThreadId, loadThreads]);

  return {
    // State
    threads,
    activeThread,
    activeThreadId,
    isLoading,
    // Actions
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
