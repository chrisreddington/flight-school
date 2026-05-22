/**
 * Per-user deletion tombstone.
 *
 * `DELETE /api/user/data` cancels in-flight jobs, but some executors
 * (notably {@link executeChatResponse}) may still hold a Copilot SDK
 * session open and try to flush a final delta to `threads.json` after
 * the cancellation signal — racing the wipe and silently recreating
 * the user's data immediately after they asked to delete it
 * (rubber-duck #6).
 *
 * The fix: write `users/{userId}/.deleted` BEFORE we delete the user's
 * directory. Every background writer that touches per-user state
 * checks {@link isUserDeleted} first and aborts cleanly when set.
 * The marker is cleared on the user's next successful sign-in.
 *
 * In-memory cache mirrors the on-disk marker so hot-path writers
 * (streaming deltas at ~400ms cadence) don't pay an `fs.stat` per
 * delta.
 *
 * @module storage/tombstone
 */

import 'server-only';
import { deleteFile, readFile, writeFile } from './utils';

const TOMBSTONE_FILENAME = '.deleted';

const tombstoneCache = new Map<string, true>();

/** Mark `userId` as deleted. Idempotent. */
export async function markUserDeleted(userId: string): Promise<void> {
  await writeFile(`users/${userId}`, TOMBSTONE_FILENAME, new Date().toISOString());
  tombstoneCache.set(userId, true);
}

/**
 * True when {@link markUserDeleted} has been called for `userId` and
 * the marker is still present on disk. Cached in-process; falls back
 * to a single `readFile` on a cache miss so it survives process
 * restarts.
 */
export async function isUserDeleted(userId: string): Promise<boolean> {
  if (tombstoneCache.has(userId)) return true;
  const marker = await readFile(`users/${userId}`, TOMBSTONE_FILENAME);
  if (marker !== null) {
    tombstoneCache.set(userId, true);
    return true;
  }
  return false;
}

/** Clear the tombstone (call on successful sign-in for `userId`). */
export async function clearUserTombstone(userId: string): Promise<void> {
  tombstoneCache.delete(userId);
  await deleteFile(`users/${userId}`, TOMBSTONE_FILENAME);
}
