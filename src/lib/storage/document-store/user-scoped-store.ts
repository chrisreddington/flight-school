/**
 * The user-scoped wrapper over a raw {@link DocumentStore} (§0.3, §A.5).
 *
 * A raw store takes an explicit `partitionKey` on every call, which makes
 * cross-tenant access a one-typo mistake. This wrapper closes that gap: it is
 * constructed from a server-resolved `userId`, bakes that id in as the
 * partition key for every operation, and exposes only `(container, id)` —
 * domain code literally cannot name another tenant's partition.
 *
 * Beyond isolation, the write path guards the deletion tombstone so a slow
 * background job (a focus generation that started before "delete my account"
 * landed) cannot resurrect a just-deleted user. The guard runs at three points
 * and orders the registry write FIRST, so the registry-first invariant holds:
 * any data this write lands is always discoverable through a registry entry, so
 * the S1.5 retention sweep can reap it even after a crash. If the guard catches
 * a lost race it rolls back narrowly — removing only the single document it
 * wrote and only a registry entry it created — because tombstones clear on the
 * user's next sign-in (§A.5) and a returning user reuses the same partition.
 *
 * @module storage/document-store/user-scoped-store
 */

import { SAFE_USER_ID } from '../user-scope';
import { ensureUserRegistered, removeUserRegistration, type RegistrationOutcome } from './user-registry';
import type { ContainerName, DocumentEnvelope, DocumentStore, ListOptions, ListResult, PutOptions } from './types';

/**
 * Thrown when a write targets a user whose deletion tombstone is set. Distinct
 * from a CAS conflict: the caller must NOT retry — the user is gone.
 */
export class UserDeletedError extends Error {
  readonly code = 'USER_DELETED';

  constructor(userId: string) {
    super(`Refusing write for deleted user: ${userId}`);
    this.name = 'UserDeletedError';
  }
}

/** The per-user partitioned façade domain repositories depend on. */
export interface UserScopedStore {
  get<T>(container: ContainerName, id: string): Promise<T | null>;
  getEnvelope<T>(container: ContainerName, id: string): Promise<DocumentEnvelope<T> | null>;
  put<T>(container: ContainerName, id: string, body: T, opts?: PutOptions): Promise<DocumentEnvelope<T>>;
  remove(container: ContainerName, id: string): Promise<void>;
  list<T>(container: ContainerName, opts?: ListOptions): Promise<ListResult<T>>;
  removeByParent(container: ContainerName, parentId: string): Promise<void>;
  deletePartition(container: ContainerName): Promise<void>;
}

/** Production construction options. */
export interface UserScopedStoreOptions {
  /**
   * Resolves whether the user's deletion tombstone is set. Injected as a seam
   * (rather than coupling to a concrete tombstone module) so the tombstone
   * storage can migrate in S1.5 without touching this write path.
   */
  isUserDeleted: (userId: string) => Promise<boolean>;
}

/**
 * Test-only options. The `onAfterRegistryEnsure` hook is deliberately absent
 * from {@link UserScopedStoreOptions}, so wiring it through the production
 * factory is a COMPILE error — there is no way to inject test timing into
 * shipped code.
 */
export interface UserScopedStoreTestOptions extends UserScopedStoreOptions {
  /** Fires after the registry ensure, before the data write — drives the mid-write guard in tests. */
  onAfterRegistryEnsure?: () => void | Promise<void>;
}

/**
 * Build the wrapper. Internal to this module; the exported factories below pin
 * the public (production vs test) options surface.
 */
function buildUserScopedStore(
  userId: string,
  store: DocumentStore,
  options: UserScopedStoreTestOptions,
): UserScopedStore {
  if (!SAFE_USER_ID.test(userId)) {
    throw new Error(`Refusing unsafe userId for user-scoped store: ${JSON.stringify(userId)}`);
  }

  const { isUserDeleted, onAfterRegistryEnsure } = options;

  /**
   * Undo a write that lost the deletion race, narrowly and crash-safely.
   *
   * Narrow: it removes ONLY the single document this write created
   * (`writtenId`) — never the whole partition. Tombstones are not monotonic
   * (they clear on the user's next sign-in, §A.5), so a returning user reuses
   * this same partition; a whole-partition wipe here could destroy that
   * returning user's fresh data. A `writtenId` of `null` (the mid-write guard,
   * before any data write) removes no document at all.
   *
   * Registry-conditional: it removes the registry entry only when THIS write
   * created it (`'created'`). A returning user's pre-existing entry
   * (`'exists'`) is left untouched.
   *
   * Crash-safe ordering: the data document is removed BEFORE the registry
   * entry, so an interrupted rollback can only ever leave the harmless residual
   * (a registry entry with no data) — never undiscoverable data that has lost
   * its registry pointer. All operations are idempotent.
   */
  async function rollbackResurrection(
    container: ContainerName,
    writtenId: string | null,
    registration: RegistrationOutcome,
  ): Promise<void> {
    if (writtenId !== null) {
      await store.remove(container, userId, writtenId);
    }
    if (registration === 'created') {
      await removeUserRegistration(store, userId);
    }
  }

  async function put<T>(
    container: ContainerName,
    id: string,
    body: T,
    opts?: PutOptions,
  ): Promise<DocumentEnvelope<T>> {
    if (await isUserDeleted(userId)) {
      throw new UserDeletedError(userId);
    }

    const registration = await ensureUserRegistered(store, userId);

    if (onAfterRegistryEnsure) {
      await onAfterRegistryEnsure();
    }

    if (await isUserDeleted(userId)) {
      await rollbackResurrection(container, null, registration);
      throw new UserDeletedError(userId);
    }

    const envelope = await store.put<T>(container, userId, id, body, opts);

    if (await isUserDeleted(userId)) {
      await rollbackResurrection(container, id, registration);
      throw new UserDeletedError(userId);
    }

    return envelope;
  }

  return {
    get: (container, id) => store.get(container, userId, id),
    getEnvelope: (container, id) => store.getEnvelope(container, userId, id),
    put,
    remove: (container, id) => store.remove(container, userId, id),
    list: (container, opts) => store.list(container, userId, opts),
    removeByParent: (container, parentId) => store.removeByParent(container, userId, parentId),
    deletePartition: (container) => store.deletePartition(container, userId),
  };
}

/**
 * Construct a user-scoped store for a server-resolved `userId`. The `userId`
 * MUST originate from {@link import('@/lib/auth/context').requireUserContext}
 * or an equivalent authenticated identity — never from client input.
 */
export function createUserScopedStore(
  userId: string,
  store: DocumentStore,
  options: UserScopedStoreOptions,
): UserScopedStore {
  return buildUserScopedStore(userId, store, options);
}

/**
 * Test-only factory that accepts the `onAfterRegistryEnsure` timing hook.
 * Production code physically cannot reach this seam.
 */
export function createUserScopedStoreForTest(
  userId: string,
  store: DocumentStore,
  options: UserScopedStoreTestOptions,
): UserScopedStore {
  return buildUserScopedStore(userId, store, options);
}
