/**
 * Per-user store resolver for the server request path.
 *
 * Wires the process-wide {@link DocumentStore} to a single user's
 * {@link UserScopedStore}, baking the server-resolved `userId` as the partition
 * key and injecting the deletion-tombstone seam, so the tenancy + tombstone
 * guard lives in exactly one place.
 *
 * @remarks
 * This module imports the `server-only`-tainted {@link isUserDeleted}, so it is
 * reachable from Web/API request handlers and CLI tooling but NOT from the
 * Next-free worker. A worker-safe variant would inject the tombstone seam
 * rather than importing it directly; that wiring is deferred (tracked as the
 * S1.5 worker-injection follow-up). The caller resolves `userId` from a trusted
 * source (Auth.js session) — never client input.
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
