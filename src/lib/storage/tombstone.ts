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
 * The fix: write the tombstone BEFORE deleting the user's directory.
 * Every background writer that touches per-user state checks
 * {@link isUserDeleted} first and aborts cleanly when set.
 *
 * ## Phase 5 path migration
 *
 * The tombstone used to live at `users/{userId}/.deleted` — INSIDE
 * the subtree the deletion endpoint then wiped. That meant the
 * tombstone itself was removed by the cleanup, so a late executor
 * write that arrived after the wipe re-materialised user data and
 * was no longer blocked by the marker (the marker was already gone).
 *
 * Phase 5 moves the path to `tombstones/{userId}` — OUTSIDE the
 * deleted subtree. A late write is now blocked indefinitely; only an
 * explicit successful sign-in clears the marker. The reader still
 * falls back to the legacy path so tombstones written by older
 * builds remain effective during a rolling deploy.
 *
 * @module storage/tombstone
 */

import 'server-only';
import { deleteFile, readFile, writeFile } from './utils';

const TOMBSTONE_DIR = 'tombstones';
const LEGACY_TOMBSTONE_DIR_PREFIX = 'users/';
const LEGACY_TOMBSTONE_FILENAME = '.deleted';

const tombstoneCache = new Map<string, true>();

/** Mark `userId` as deleted. Idempotent. */
export async function markUserDeleted(userId: string): Promise<void> {
  await writeFile(TOMBSTONE_DIR, userId, new Date().toISOString());
  tombstoneCache.set(userId, true);
}

/**
 * True when {@link markUserDeleted} has been called for `userId` and
 * the marker is still present on disk. Cached in-process; falls back
 * to a `readFile` on the new and legacy paths so it survives process
 * restarts and rolling deploys.
 */
export async function isUserDeleted(userId: string): Promise<boolean> {
  if (tombstoneCache.has(userId)) return true;
  const marker = await readFile(TOMBSTONE_DIR, userId);
  if (marker !== null) {
    tombstoneCache.set(userId, true);
    return true;
  }
  // Legacy fallback: pre-Phase-5 builds wrote to `users/{userId}/.deleted`.
  // Honour it so a deploy that interleaves old & new instances doesn't
  // accidentally resurrect a deleted user.
  const legacy = await readFile(
    `${LEGACY_TOMBSTONE_DIR_PREFIX}${userId}`,
    LEGACY_TOMBSTONE_FILENAME,
  );
  if (legacy !== null) {
    tombstoneCache.set(userId, true);
    return true;
  }
  return false;
}

/** Clear the tombstone (call on successful sign-in for `userId`). */
export async function clearUserTombstone(userId: string): Promise<void> {
  tombstoneCache.delete(userId);
  await deleteFile(TOMBSTONE_DIR, userId);
  // Clear the legacy location too so a subsequent isUserDeleted lookup
  // doesn't flap back to true via the legacy fallback path.
  await deleteFile(
    `${LEGACY_TOMBSTONE_DIR_PREFIX}${userId}`,
    LEGACY_TOMBSTONE_FILENAME,
  );
}
