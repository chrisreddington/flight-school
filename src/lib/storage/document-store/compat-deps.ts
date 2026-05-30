/**
 * Production {@link CompatDeps} factory for the read-through-migrating compat
 * core.
 *
 * The pure core in {@link import('./user-storage-core')} is Next-free and
 * deps-injected so it can be parity-tested without auth or env. This module
 * supplies the REAL dependencies for an already-resolved `userId`: the
 * user-scoped envelope store plus a legacy seam that reads/clears the user's
 * `users/{userId}/...` file. It is intentionally SERVER-SIDE — it imports the
 * `server-only`-marked envelope backend ({@link getUserScopedStoreForUser}) —
 * so the singleton repos built on top of it are web/server accessors, never
 * worker-reached. (The worker uses the Next-free `@/lib/storage/utils` seam.)
 *
 * Splitting this out of `../user-storage` keeps the repos free of the auth
 * dependency (`requireUserContext`): a repo takes an explicit, already-trusted
 * `userId` and never re-authenticates.
 *
 * @module storage/document-store/compat-deps
 */

import { deleteFile, readFile } from '../utils';
import { SAFE_USER_ID } from '../user-scope';
import { getUserScopedStoreForUser } from './scoped-store';
import type { CompatDeps, LegacyDocumentIO } from './user-storage-core';

/**
 * Build the production {@link CompatDeps} for `userId`: the user-scoped envelope
 * store plus a legacy seam that reads/clears the user's `users/{userId}/...`
 * file WITHOUT the self-heal write-back the legacy primitives would do.
 *
 * Validates `userId` against {@link SAFE_USER_ID} before constructing any path
 * so an unsafe identifier can never build a `users/{userId}` legacy path. The
 * envelope store applies the same guard internally; doing it here closes the
 * legacy seam, which the store guard does not cover.
 *
 * @param userId - Stable user identifier (numeric GitHub ID as string). MUST
 *   come from a server-resolved identity, never from client input.
 * @throws {Error} when `userId` fails {@link SAFE_USER_ID} validation. The
 *   message contains "unsafe userId" so route adapters can map it to a 400.
 */
export async function buildCompatDeps(userId: string): Promise<CompatDeps> {
  if (!SAFE_USER_ID.test(userId)) {
    throw new Error(`Refusing unsafe userId for storage path: ${JSON.stringify(userId)}`);
  }
  const store = await getUserScopedStoreForUser(userId);
  const legacy: LegacyDocumentIO = {
    readRaw: (filename) => readFile(`users/${userId}`, filename),
    remove: (filename) => deleteFile(`users/${userId}`, filename),
  };
  return { store, legacy };
}
