/**
 * Per-user store resolver (Next-free, worker-safe).
 *
 * Wires the process-wide {@link DocumentStore} to a single user's
 * {@link UserScopedStore}, baking the server-resolved `userId` as the partition
 * key and injecting the deletion-tombstone seam. Both the Web/API request path
 * and the worker job path resolve their store through here, so the tenancy +
 * tombstone guard lives in exactly one place.
 *
 * This module is deliberately free of any `@/lib/auth/*` or `next/*` import so
 * the Next-free worker can reach it directly (the worker resolves `userId` from
 * the persisted job payload, not from a request). The request-scoped wrapper
 * that calls {@link requireUserContext} lives in `./request-store`.
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
