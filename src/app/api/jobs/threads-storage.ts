/**
 * Thread Storage Utilities (Server-side)
 * 
 * Direct thread storage access for API routes without going through client hooks.
 */

import { readStorage, writeStorage } from '@/lib/storage/utils';
import type { Thread } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';

interface ThreadsStorageSchema {
  threads: Thread[];
}

const DEFAULT_THREADS_SCHEMA: ThreadsStorageSchema = { threads: [] };

function validateThreadsSchema(data: unknown): data is ThreadsStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return Array.isArray(schema.threads);
}

/** Read threads directly from storage (server-side) */
export async function readThreadsStorage(): Promise<Thread[]> {
  const storage = await readStorage<ThreadsStorageSchema>(
    'threads.json',
    DEFAULT_THREADS_SCHEMA,
    validateThreadsSchema
  );
  return storage.threads;
}

/** Write threads directly to storage (server-side) */
export async function writeThreadsStorage(threads: Thread[]): Promise<void> {
  await writeStorage('threads.json', { threads });
}

/** Get a thread by ID directly from storage (server-side) */
export async function getThreadById(threadId: string): Promise<Thread | null> {
  const threads = await readThreadsStorage();
  return threads.find(t => t.id === threadId) ?? null;
}

/** Update a thread directly in storage (server-side) */
export async function updateThread(updatedThread: Thread): Promise<void> {
  const threads = await readThreadsStorage();
  const index = threads.findIndex(t => t.id === updatedThread.id);
  if (index >= 0) {
    threads[index] = { ...updatedThread, updatedAt: now() };
  } else {
    threads.unshift(updatedThread);
  }
  await writeThreadsStorage(threads);
}
