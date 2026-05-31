/**
 * The sharded user-registry (§A.4) — the index retention sweeps instead of
 * enumerating every storage partition.
 *
 * Each registered user is one `system` item at `pk=registry-{NN}`,
 * `id=user-{userId}`, where `NN` is the first byte of `sha256(userId)` in
 * lowercase hex. SHA-256's leading byte spreads users uniformly across a fixed
 * 256-bucket set that is identical on every runtime, so the active-user set is
 * fully enumerable by walking those known buckets — no cross-partition scan,
 * which on Cosmos would be an O(all-users) query and a hot-partition risk.
 *
 * The registry is maintained as idempotent eventual consistency, never a
 * cross-partition transaction: callers ensure the registry entry FIRST (with
 * `ifNoneMatch:'*'`), treat a conflict as success, and only then write user
 * data — so the only crash residual is a harmless empty-partition entry, never
 * the dangerous inverse (data with no discoverable registry entry).
 *
 * @module storage/document-store/user-registry
 */

import { createHash } from 'crypto';

import { DocumentConflictError, type DocumentStore } from './types';

/** The `metadata.type` every registry item carries, so the sweep can filter. */
const REGISTRY_ITEM_TYPE = 'user-registry';

/** The fixed bucket count — every shard from `registry-00` to `registry-ff`. */
const REGISTRY_SHARD_COUNT = 256;

/** How many registry items a single sweep page pulls per shard. */
const REGISTRY_SWEEP_PAGE_SIZE = 200;

/** The immutable body stored for each registered user. */
export interface UserRegistryEntry {
  userId: string;
  registeredAt: string;
}

/**
 * Whether {@link ensureUserRegistered} created a new registry entry this call
 * (`'created'`) or found one already present (`'exists'`). Callers that may
 * need to roll back a write use this to remove ONLY a registry entry they
 * themselves created, never a returning user's pre-existing one.
 */
export type RegistrationOutcome = 'created' | 'exists';

/**
 * The `registry-{NN}` shard a user id hashes into. Stable and
 * serializer-neutral: the first byte of the UTF-8 SHA-256 digest rendered as
 * two lowercase hex chars. The hyphen (not a colon) keeps the partition key
 * within `SAFE_PATH_SEGMENT` on the file adapter.
 */
export function registryShardFor(userId: string): string {
  const firstDigestByte = createHash('sha256').update(userId, 'utf-8').digest()[0];
  return `registry-${firstDigestByte.toString(16).padStart(2, '0')}`;
}

/** The registry item id for a user — `user-{userId}`, hyphen-separated. */
export function registryItemId(userId: string): string {
  return `user-${userId}`;
}

/** Every shard partition key, in `registry-00`..`registry-ff` order. */
function allRegistryShards(): string[] {
  const shards: string[] = [];
  for (let bucket = 0; bucket < REGISTRY_SHARD_COUNT; bucket += 1) {
    shards.push(`registry-${bucket.toString(16).padStart(2, '0')}`);
  }
  return shards;
}

/**
 * Ensure a registry entry exists for `userId`. Idempotent: a create race or a
 * returning user surfaces as {@link DocumentConflictError}, which is swallowed
 * as success (return `'exists'`) so the original `registeredAt` is preserved.
 * Every other error propagates so the caller aborts the user write rather than
 * leaving data without a discoverable registry entry. Returns whether the entry
 * was created this call so a rolling-back caller removes only its own creation.
 */
export async function ensureUserRegistered(store: DocumentStore, userId: string): Promise<RegistrationOutcome> {
  const entry: UserRegistryEntry = { userId, registeredAt: new Date().toISOString() };
  try {
    await store.put('system', registryShardFor(userId), registryItemId(userId), entry, {
      ifNoneMatch: '*',
      metadata: { type: REGISTRY_ITEM_TYPE },
    });
    return 'created';
  } catch (error) {
    if (error instanceof DocumentConflictError) return 'exists';
    throw error;
  }
}

/** Remove a user's registry entry. Idempotent (absent entry = success). */
export async function removeUserRegistration(store: DocumentStore, userId: string): Promise<void> {
  await store.remove('system', registryShardFor(userId), registryItemId(userId));
}

/**
 * Yield every registered user id by walking the fixed 256-bucket set
 * shard-by-shard, page-by-page. Bounded and deterministic — the bucket set is
 * known a priori, so retention never falls back to a cross-partition scan.
 */
export async function* iterateRegisteredUsers(store: DocumentStore): AsyncGenerator<string> {
  for await (const entry of iterateRegisteredEntries(store)) {
    yield entry.userId;
  }
}

/**
 * Yield the full {@link UserRegistryEntry} (user id + `registeredAt`) of every
 * registered user, walking the same fixed bucket set as
 * {@link iterateRegisteredUsers}. Retention's age guard needs `registeredAt` to
 * spare freshly-registered-but-empty users from a prune race, so it walks the
 * entries rather than the bare ids.
 */
export async function* iterateRegisteredEntries(store: DocumentStore): AsyncGenerator<UserRegistryEntry> {
  for (const shard of allRegistryShards()) {
    let cursor: string | undefined;
    do {
      const page = await store.list<UserRegistryEntry>('system', shard, {
        type: REGISTRY_ITEM_TYPE,
        limit: REGISTRY_SWEEP_PAGE_SIZE,
        cursor,
      });
      for (const envelope of page.items) {
        yield envelope.body;
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
}

/** Collect every registered user id into an array (convenience over the sweep). */
export async function collectRegisteredUsers(store: DocumentStore): Promise<string[]> {
  const userIds: string[] = [];
  for await (const userId of iterateRegisteredUsers(store)) {
    userIds.push(userId);
  }
  return userIds;
}
