/**
 * Thread Storage Utilities (Server-side, **per-user**)
 *
 * Server-side reads/writes for thread storage used by background job
 * executors. The HTTP route `/api/threads/storage` writes per-user via
 * {@link createStorageRoute}, which routes the `threads.json` filename through
 * the same envelope {@link import('@/lib/storage/document-store/singleton-repo')}
 * these helpers use, so executors read the same document the client wrote.
 *
 * This module is **worker-reached** (job executors persist thread deltas). The
 * envelope chain stays Next-free for the worker bundle: the worker esbuild
 * shims `server-only` and nothing here imports `next/*`
 * (`scripts/check-worker-next-free.mjs` enforces it).
 *
 * Every function takes `userId` from a server-resolved identity
 * (Auth.js session or the persisted job payload populated by an
 * authenticated request). Never accept `userId` from client input.
 *
 * @module jobs/threads-storage
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import { UserDeletedError } from '@/lib/storage/document-store/user-scoped-store';
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

const threadsRepo = createSingletonRepo<ThreadsStorageSchema>({
  filename: 'threads.json',
  defaultValue: DEFAULT_THREADS_SCHEMA,
  guard: validateThreadsSchema,
});

/**
 * Read threads directly from storage for a specific user.
 *
 * Exported so the retention sweeper can bulk-read, filter, and rewrite a
 * user's threads through the same envelope the executors use.
 */
export async function readThreadsStorage(userId: string): Promise<Thread[]> {
  const storage = await threadsRepo.read(userId);
  return storage.threads;
}

/**
 * Write threads directly to storage for a specific user.
 *
 * Aborts silently when the user's deletion tombstone is set so
 * `DELETE /api/user/data` can't be raced by a late-arriving executor
 * delta (rubber-duck #6) — the store rejects the write with
 * {@link UserDeletedError}. The tombstone is cleared on next successful
 * sign-in. Exported for the retention sweeper.
 */
export async function writeThreadsStorage(userId: string, threads: Thread[]): Promise<void> {
  try {
    await threadsRepo.write(userId, { threads });
  } catch (error) {
    if (error instanceof UserDeletedError) return;
    throw error;
  }
}

/** Get a thread by ID directly from storage for a specific user. */
export async function getThreadById(userId: string, threadId: string): Promise<Thread | null> {
  const threads = await readThreadsStorage(userId);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return null;
  // Strip the `▊` cursor glyph from any thread last persisted by an
  // older worker that wrote partial assistant content into the
  // durable thread.
  return stripLegacyCursorFromThread(thread);
}

/** Update a thread directly in storage for a specific user. */
export async function updateThread(userId: string, updatedThread: Thread): Promise<void> {
  const threads = await readThreadsStorage(userId);
  const index = threads.findIndex((t) => t.id === updatedThread.id);
  if (index >= 0) {
    threads[index] = { ...updatedThread, updatedAt: now() };
  } else {
    threads.unshift(updatedThread);
  }
  await writeThreadsStorage(userId, threads);
}
