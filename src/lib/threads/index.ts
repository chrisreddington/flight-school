/**
 * Threads Module
 *
 * Multi-thread chat system with server-side JSON persistence.
 * Provides types, storage, and utilities for managing chat threads.
 *
 * @example
 * ```typescript
 * import { threadStore, type Thread } from '@/lib/threads';
 *
 * const thread = await threadStore.create({ title: 'Learning React' });
 * const all = await threadStore.getAll();
 * ```
 */

// Types
export type {
    CreateThreadOptions,
    Message,
    RepoReference,
    Thread,
    ThreadContext
} from './types';

// Storage
export { threadStore } from './storage';

/**
 * Event name for notifying React components that thread data has changed.
 * Dispatch this after persisting thread data to trigger UI refresh.
 */
export const THREAD_DATA_CHANGED_EVENT = 'thread-data-changed';

/**
 * Dispatch thread data changed event to notify all listeners.
 * Call this after successfully persisting thread data from background jobs.
 * 
 * @param threadId - The ID of the thread that changed
 */
export function notifyThreadDataChanged(threadId?: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THREAD_DATA_CHANGED_EVENT, {
      detail: { threadId }
    }));
  }
}
