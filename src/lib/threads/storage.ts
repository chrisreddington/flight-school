/**
 * Thread Storage
 *
 * Provides persistent storage for chat threads using server-side JSON storage.
 * Abstracted behind ThreadStore interface for swappability.
 *
 * @remarks
 * This module uses the `/api/threads/storage` API route for persistence
 * instead of localStorage. The data is stored server-side in `.data/threads.json`.
 */

import { apiGet, apiPost } from '@/lib/api-client';
import { now } from '@/lib/utils/date-utils';
import { generateId } from '@/lib/utils/id-generator';
import { logger } from '@/lib/logger';
import type { CreateThreadOptions, Thread, ThreadContext } from './types';

const log = logger.withTag('ThreadStore');

// =============================================================================
// Storage Interface
// =============================================================================

/**
 * Interface for thread storage operations.
 *
 * Abstracts storage to allow swapping backends.
 */
interface ThreadStore {
  /** Get all threads, ordered by most recently updated */
  getAll(): Promise<Thread[]>;
  /** Get a specific thread by ID */
  getById(id: string): Promise<Thread | null>;
  /** Create a new thread */
  create(options?: CreateThreadOptions): Promise<Thread>;
  /** Update an existing thread */
  update(thread: Thread): Promise<Thread>;
  /** Delete a thread by ID */
  delete(id: string): Promise<void>;
  /** Update thread context */
  updateContext(id: string, context: Partial<ThreadContext>): Promise<Thread | null>;
  /** Rename a thread */
  rename(id: string, title: string): Promise<Thread | null>;
}

// =============================================================================
// Server-backed Implementation
// =============================================================================

/** Schema for threads storage API */
interface ThreadsStorageSchema {
  threads: Thread[];
}

/**
 * Server-backed implementation of ThreadStore.
 *
 * @remarks
 * - Persists threads to server-side JSON file via API
 * - Returns threads ordered by most recently updated
 * - Thread IDs are guaranteed unique via timestamp + random suffix
 */
class ServerThreadStore implements ThreadStore {
  private async getStorage(): Promise<Thread[]> {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const schema = await apiGet<ThreadsStorageSchema>('/api/threads/storage');
      // Sort by most recently updated
      return schema.threads.sort((a, b) => 
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    } catch (error) {
      log.error('Failed to load threads storage', error);
      return [];
    }
  }

  private async setStorage(threads: Thread[]): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const schema: ThreadsStorageSchema = { threads };
      await apiPost<void>('/api/threads/storage', schema);
    } catch (error) {
      log.error('Failed to save to threads storage', { error });
      throw error;
    }
  }

  async getAll(): Promise<Thread[]> {
    return this.getStorage();
  }

  async getById(id: string): Promise<Thread | null> {
    const threads = await this.getStorage();
    return threads.find((t) => t.id === id) ?? null;
  }

  async create(options?: CreateThreadOptions): Promise<Thread> {
    const timestamp = now();
    const thread: Thread = {
      id: generateId('thread'),
      title: options?.title ?? 'New Thread',
      context: {
        repos: options?.context?.repos ?? [],
        learningFocus: options?.context?.learningFocus,
      },
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const threads = await this.getStorage();
    threads.unshift(thread); // Add to front (most recent)
    await this.setStorage(threads);
    return thread;
  }

  async update(thread: Thread): Promise<Thread> {
    const threads = await this.getStorage();
    const index = threads.findIndex((t) => t.id === thread.id);
    if (index === -1) {
      // Thread doesn't exist, create it
      threads.unshift(thread);
    } else {
      // Update existing thread
      threads[index] = {
        ...thread,
        updatedAt: now(),
      };
    }
    await this.setStorage(threads);
    return thread;
  }

  async delete(id: string): Promise<void> {
    const threads = await this.getStorage();
    const filtered = threads.filter((t) => t.id !== id);
    await this.setStorage(filtered);
  }

  async updateContext(id: string, context: Partial<ThreadContext>): Promise<Thread | null> {
    const thread = await this.getById(id);
    if (!thread) return null;
    
    const updated: Thread = {
      ...thread,
      context: { ...thread.context, ...context },
      updatedAt: now(),
    };
    return this.update(updated);
  }

  async rename(id: string, title: string): Promise<Thread | null> {
    const thread = await this.getById(id);
    if (!thread) return null;
    
    const updated: Thread = {
      ...thread,
      title,
      updatedAt: now(),
    };
    return this.update(updated);
  }

  /**
   * Clears all threads from storage.
   */
  async clearAll(): Promise<void> {
    if (typeof window === 'undefined') return;
    
    try {
      await this.setStorage([]);
      log.debug('All threads cleared');
    } catch (error) {
      log.error('Failed to clear all threads', { error });
      throw error;
    }
  }
}

/** Default singleton instance for convenience */
export const threadStore = new ServerThreadStore();
