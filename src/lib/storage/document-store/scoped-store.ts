/**
 * Per-user store resolver for the server request path.
 *
 * Wires the process-wide {@link DocumentStore} to a single user's
 * {@link UserScopedStore}, baking the server-resolved `userId` as the partition
 * key and injecting the deletion-tombstone seam, so the tenancy + tombstone
 * guard lives in exactly one place.
 *
 * @remarks
 * This module imports {@link isUserDeleted} from the tombstone seam. It is
 * reachable from Web/API request handlers, CLI tooling, AND the Next-free
 * worker (via the evaluations/threads singleton repos): the worker esbuild
 * shims `server-only` and neither this module nor `../tombstone` imports
 * `next/*`, so the worker bundle stays Next-free (enforced by
 * `scripts/check-worker-next-free.mjs`). The caller resolves `userId` from a
 * trusted source (Auth.js session or persisted job payload) — never client
 * input.
 *
 * @module storage/document-store/scoped-store
 */

import { isUserDeleted } from '../tombstone';
import { getDocumentStore } from './factory';
import { createUserScopedStore, type UserScopedStore } from './user-scoped-store';

/**
 * Resolve the {@link UserScopedStore} for `userId`.
 *
 * The caller is responsible for having authenticated the user and extracted a
 * trusted `userId` (Auth.js session or persisted job payload) — never client
 * input. The returned façade refuses writes once the user's tombstone is set.
 */
export async function getUserScopedStoreForUser(userId: string): Promise<UserScopedStore> {
  const store = await getDocumentStore();
  return createUserScopedStore(userId, store, { isUserDeleted });
}
