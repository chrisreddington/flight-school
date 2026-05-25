/**
 * Thread Storage Utilities (Server-side, **per-user**)
 *
 * Server-side reads/writes for thread storage used by background job
 * executors. The HTTP route `/api/threads/storage` writes per-user via
 * {@link createStorageRoute}, which routes through
 * `users/{userId}/threads.json` (see `@/lib/storage/user-scope`).
 * These helpers MUST use the same per-user partitioning so executors
 * read the same file the client wrote.
 *
 * Every function takes `userId` from a server-resolved identity
 * (Auth.js session or the persisted job payload populated by an
 * authenticated request). Never accept `userId` from client input.
 *
 * @module jobs/threads-storage
 */

import { readStorage, writeStorage, ensureDir } from '@/lib/storage/utils';
import { isUserDeleted } from '@/lib/storage/tombstone';
import { userScopedFilename } from '@/lib/storage/user-scope';
import type { Thread } from '@/lib/threads';
import { stripLegacyCursorFromThread } from '@/lib/threads/legacy-cursor';
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

/** Read threads directly from storage for a specific user. */
async function readThreadsStorage(userId: string): Promise<Thread[]> {
  const storage = await readStorage<ThreadsStorageSchema>(
    userScopedFilename(userId, 'threads.json'),
    DEFAULT_THREADS_SCHEMA,
    validateThreadsSchema
  );
  return storage.threads;
}

/**
 * Write threads directly to storage for a specific user.
 *
 * Aborts silently when the user's deletion tombstone is set so
 * `DELETE /api/user/data` can't be raced by a late-arriving executor
 * delta (rubber-duck #6). The tombstone is cleared on next successful
 * sign-in.
 */
async function writeThreadsStorage(userId: string, threads: Thread[]): Promise<void> {
  if (await isUserDeleted(userId)) return;
  await ensureDir(`users/${userId}`, { mode: 0o700 });
  await writeStorage(userScopedFilename(userId, 'threads.json'), { threads });
}

/** Get a thread by ID directly from storage for a specific user. */
export async function getThreadById(userId: string, threadId: string): Promise<Thread | null> {
  const threads = await readThreadsStorage(userId);
  const thread = threads.find(t => t.id === threadId);
  if (!thread) return null;
  // Strip the `▊` cursor glyph from any thread last persisted by an
  // older worker that wrote partial assistant content into the
  // durable thread.
  return stripLegacyCursorFromThread(thread);
}

/** Update a thread directly in storage for a specific user. */
export async function updateThread(userId: string, updatedThread: Thread): Promise<void> {
  const threads = await readThreadsStorage(userId);
  const index = threads.findIndex(t => t.id === updatedThread.id);
  if (index >= 0) {
    threads[index] = { ...updatedThread, updatedAt: now() };
  } else {
    threads.unshift(updatedThread);
  }
  await writeThreadsStorage(userId, threads);
}
