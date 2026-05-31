/**
 * Per-user deletion tombstone.
 *
 * `DELETE /api/user/data` cancels in-flight jobs, but some executors
 * (notably {@link executeChatResponse}) may still hold a Copilot SDK
 * session open and try to flush a final delta to `threads.json` after
 * the cancellation signal — racing the wipe and silently recreating
 * the user's data immediately after they asked to delete it.
 *
 * The fix: write the tombstone BEFORE deleting the user's directory.
 * Every background writer that touches per-user state checks
 * {@link isUserDeleted} first and aborts cleanly when set.
 *
 * ## Tombstone path
 *
 * The tombstone lives at `tombstones/{userId}` — outside the per-user
 * subtree that `DELETE /api/user/data` wipes. A late executor write
 * that arrives after the wipe is therefore still blocked: the marker
 * survives the cleanup and only an explicit successful sign-in clears
 * it. Lookups also fall back to the legacy `users/{userId}/.deleted`
 * path so tombstones written by older builds remain effective during a
 * rolling deploy.
 *
 * ## Cross-process freshness (no positive cache)
 *
 * Every check reads the marker from disk — there is deliberately no
 * in-process positive cache. The Next.js process clears a tombstone on
 * sign-in while a SEPARATE worker process runs the write-path guard; a
 * cached `true` in the worker would outlive the clear and permanently
 * wedge a resurrected user out of their own writes. The cost is one
 * point-read per guard, which §A.5 of the storage plan accepts.
 *
 * ## Deployment invariant
 *
 * NOTE: Tombstones are raw files under `DATA_DIR`, so every process that
 *       reads or writes per-user state (web + worker + any background
 *       writer) MUST share that filesystem. This holds for the local
 *       file/sqlite default (single host, shared `DATA_DIR`). A split-host
 *       or serverless deployment must move tombstones into the `system`
 *       container before it is safe — tracked as an S2/Cosmos follow-up.
 *
 * @module storage/tombstone
 */

import 'server-only';
import { deleteFile, readFile, writeFile } from './utils';

const TOMBSTONE_DIR = 'tombstones';
const LEGACY_TOMBSTONE_DIR_PREFIX = 'users/';
const LEGACY_TOMBSTONE_FILENAME = '.deleted';

/** Mark `userId` as deleted. Idempotent. */
export async function markUserDeleted(userId: string): Promise<void> {
  await writeFile(TOMBSTONE_DIR, userId, new Date().toISOString());
}

/**
 * True when {@link markUserDeleted} has been called for `userId` and the
 * marker is still present on disk. Always reads from disk (see the module
 * note on cross-process freshness); falls back to the legacy
 * `users/{userId}/.deleted` path so tombstones written by older builds
 * stay effective during a rolling deploy.
 */
export async function isUserDeleted(userId: string): Promise<boolean> {
  const marker = await readFile(TOMBSTONE_DIR, userId);
  if (marker !== null) return true;
  const legacyMarker = await readFile(`${LEGACY_TOMBSTONE_DIR_PREFIX}${userId}`, LEGACY_TOMBSTONE_FILENAME);
  return legacyMarker !== null;
}

/** Clear the tombstone (call on successful sign-in for `userId`). */
export async function clearUserTombstone(userId: string): Promise<void> {
  await deleteFile(TOMBSTONE_DIR, userId);
  // Clear the legacy location too so a subsequent isUserDeleted lookup
  // doesn't flap back to true via the legacy fallback path.
  await deleteFile(`${LEGACY_TOMBSTONE_DIR_PREFIX}${userId}`, LEGACY_TOMBSTONE_FILENAME);
}
