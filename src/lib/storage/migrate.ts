/**
 * Standalone, non-destructive importer that promotes legacy
 * `users/{userId}/…` JSON into `_docstore` envelopes for the S1 containers.
 *
 * @remarks
 * S1 scope is the seven containers that already have repos: the five
 * singletons (skills, habits, focus, profile, challenge-queue, all
 * `id = 'current'`) plus the two by-id containers (challenges, workspaces).
 * threads/evaluations/activity are S2 and are intentionally untouched here.
 *
 * The importer talks to the RAW {@link DocumentStore} (explicit
 * `partitionKey = userId`) and rebuilds document coordinates itself, so it
 * carries none of the per-request compat wiring. It is Next-free and runs
 * under the `react-server` Node condition (see `scripts/storage-migrate.mts`).
 *
 * Safety properties:
 * - **Insert-if-absent, body-only.** An existing envelope wins; the importer
 *   only fills gaps. A divergent envelope is skipped (or overwritten under
 *   `--force`), never silently clobbered.
 * - **Non-destructive.** Legacy files are never modified or deleted, so
 *   `STORAGE_BACKEND=file` rolls the migration back.
 * - **File-backend refusal.** The file adapter's CAS has a documented TOCTOU
 *   ceiling, so a `file`-backend run REFUSES unless the operator passes
 *   `--assume-quiesced` to assert the app is stopped. sqlite runs freely.
 *
 * @module storage/migrate
 */

import { logger } from '@/lib/logger';
import type { StorageBackend } from '@/lib/storage/document-store/backend-sentinel';
import { canonicalizeBody } from '@/lib/storage/document-store/canonical';
import { getDocumentStore, resolveStorageBackend } from '@/lib/storage/document-store/factory';
import { DocumentConflictError, type ContainerName, type DocumentStore } from '@/lib/storage/document-store/types';
import { ensureUserRegistered } from '@/lib/storage/document-store/user-registry';
import { allDescriptors, enumerateUsers } from '@/lib/storage/migrate-descriptors';
import { acquireLock, releaseLock } from '@/lib/storage/migrate-lock';
import { isUserDeleted } from '@/lib/storage/tombstone';

export { StorageMigrationLockError, StaleStorageMigrationLockError } from '@/lib/storage/migrate-lock';
export { StorageMigrationUserError } from '@/lib/storage/migrate-descriptors';

const log = logger.withTag('storage-migrate');

/** `system`-container partition for the advisory migration-state document. */
const STATE_PARTITION_KEY = 'migration-storage-v1';

/** Document id of the migration-state summary within its partition. */
const STATE_DOCUMENT_ID = 'state';

/** Bounded retry budget for CAS writes of the shared migration-state doc. */
const STATE_WRITE_MAX_ATTEMPTS = 3;

/** Terminal classification of a completed migration run. */
export type MigrationStatus = 'successful' | 'completedWithSkips' | 'completedWithFailures';

/** Per-document outcome tallies accumulated across a run. */
export interface MigrationCounts {
  /** Envelopes created because the target was absent. */
  inserted: number;
  /** Existing envelopes replaced because `--force` was set and bodies differed. */
  overwritten: number;
  /** Targets whose canonical body already matched the legacy source. */
  unchanged: number;
  /** Divergent targets preserved because `--force` was not set. */
  skippedDivergent: number;
  /** Legacy sources skipped because they were corrupt or unsafe to read. */
  skippedCorrupt: number;
  /** Documents that errored (lost CAS race, unexpected store error). */
  failures: number;
}

/** Bounded summary persisted as the migration-state document and returned. */
export interface MigrationSummary {
  dryRun: boolean;
  backend: StorageBackend;
  usersProcessed: number;
  counts: MigrationCounts;
  status: MigrationStatus;
  startedAt: string;
  completedAt: string;
}

/** Options for {@link runStorageMigration}; injection seams aid testing. */
export interface StorageMigrationOptions {
  /** Overwrite divergent envelopes instead of skipping them. */
  force?: boolean;
  /** Compute and report counts without writing anything. */
  dryRun?: boolean;
  /** Migrate only this single user id instead of every registered user. */
  user?: string;
  /** Operator assertion that the app is stopped; required on the file backend. */
  assumeQuiesced?: boolean;
  /** Pre-built store (tests); defaults to {@link getDocumentStore}. */
  store?: DocumentStore;
  /** Backend override (tests); defaults to {@link resolveStorageBackend}. */
  backend?: StorageBackend;
  /** Lock-owner identity; defaults to the process id. */
  ownerId?: string;
  /** Clock seam (tests); defaults to {@link Date.now}. */
  now?: () => number;
  /** Tombstone-check seam (tests); defaults to {@link isUserDeleted}. */
  isDeleted?: (userId: string) => Promise<boolean>;
}

/** Thrown when a `file`-backend run is attempted without `--assume-quiesced`. */
export class StorageMigrationRefusedError extends Error {
  constructor() {
    super(
      'Refusing to migrate on the file backend without --assume-quiesced. ' +
        'Stop the app first, then re-run with --assume-quiesced.',
    );
    this.name = 'StorageMigrationRefusedError';
  }
}

/**
 * Applies the insert-if-absent conflict policy to one document, mutating the
 * shared {@link MigrationCounts}. Re-reads on a CAS conflict rather than
 * suppressing it, so a concurrent insert is compared, never overwritten.
 */
async function migrateDocument(
  store: DocumentStore,
  counts: MigrationCounts,
  container: ContainerName,
  userId: string,
  id: string,
  sourceBody: unknown,
  force: boolean,
): Promise<void> {
  let target = await store.getEnvelope(container, userId, id);
  if (target === null) {
    try {
      await store.put(container, userId, id, sourceBody, { ifNoneMatch: '*' });
      counts.inserted += 1;
      return;
    } catch (error) {
      if (!(error instanceof DocumentConflictError)) {
        throw error;
      }
      target = await store.getEnvelope(container, userId, id);
      if (target === null) {
        counts.failures += 1;
        log.warn('Insert conflicted but re-read found no envelope; skipping', { container, id });
        return;
      }
    }
  }

  if (canonicalizeBody(sourceBody) === canonicalizeBody(target.body)) {
    counts.unchanged += 1;
    return;
  }

  if (!force) {
    counts.skippedDivergent += 1;
    log.warn('Envelope diverges from legacy source; skipping (pass --force to overwrite)', {
      container,
      id,
    });
    return;
  }

  try {
    await store.put(container, userId, id, sourceBody, { ifMatch: target.etag });
    counts.overwritten += 1;
  } catch (error) {
    if (error instanceof DocumentConflictError) {
      counts.failures += 1;
      log.warn('Force overwrite lost a CAS race; skipping', { container, id });
      return;
    }
    throw error;
  }
}

/**
 * Computes the would-be outcome of one document without writing, mutating the
 * shared {@link MigrationCounts} for the dry-run report.
 */
async function previewDocument(
  store: DocumentStore,
  counts: MigrationCounts,
  container: ContainerName,
  userId: string,
  id: string,
  sourceBody: unknown,
  force: boolean,
): Promise<void> {
  const target = await store.getEnvelope(container, userId, id);
  if (target === null) {
    counts.inserted += 1;
    return;
  }
  if (canonicalizeBody(sourceBody) === canonicalizeBody(target.body)) {
    counts.unchanged += 1;
    return;
  }
  if (force) {
    counts.overwritten += 1;
  } else {
    counts.skippedDivergent += 1;
  }
}

/** Classifies a run by precedence: failures, then skips, then clean. */
function deriveStatus(counts: MigrationCounts): MigrationStatus {
  if (counts.failures > 0) {
    return 'completedWithFailures';
  }
  if (counts.skippedDivergent > 0 || counts.skippedCorrupt > 0) {
    return 'completedWithSkips';
  }
  return 'successful';
}

/**
 * Persists the advisory migration-state summary with CAS, retrying a bounded
 * number of times when a concurrent writer wins the race. The summary is
 * advisory only: the live envelope compare is the sole correctness gate.
 */
async function writeStateDocument(store: DocumentStore, summary: MigrationSummary): Promise<void> {
  for (let attempt = 0; attempt < STATE_WRITE_MAX_ATTEMPTS; attempt += 1) {
    const target = await store.getEnvelope('system', STATE_PARTITION_KEY, STATE_DOCUMENT_ID);
    const options = target === null ? { ifNoneMatch: '*' as const } : { ifMatch: target.etag };
    try {
      await store.put('system', STATE_PARTITION_KEY, STATE_DOCUMENT_ID, summary, options);
      return;
    } catch (error) {
      const isLastAttempt = attempt === STATE_WRITE_MAX_ATTEMPTS - 1;
      if (error instanceof DocumentConflictError && !isLastAttempt) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Drops users whose deletion tombstone is set, warning once per skip. The
 * importer writes through the RAW store (bypassing the user-scoped tombstone
 * guard), so without this filter a re-run could resurrect a deleted user's
 * data. Applies to dry-run too, so the preview matches a real run.
 *
 * @param userIds - Candidate users to filter.
 * @param isDeleted - Tombstone-check seam (injected for deterministic tests).
 */
async function excludeTombstonedUsers(
  userIds: string[],
  isDeleted: (userId: string) => Promise<boolean>,
): Promise<string[]> {
  const liveUserIds: string[] = [];
  for (const userId of userIds) {
    if (await isDeleted(userId)) {
      log.warn('Skipping tombstoned user; not migrating deleted data', { userId });
      continue;
    }
    liveUserIds.push(userId);
  }
  return liveUserIds;
}

/**
 * Promotes every legacy S1 document for the selected users into envelopes.
 *
 * @param options - Behaviour flags and test injection seams.
 * @returns A bounded summary of the run, also persisted as the migration-state
 *   document on a non-dry run.
 * @throws StorageMigrationRefusedError On a `file` backend without
 *   `assumeQuiesced`.
 * @throws StorageMigrationLockError When another live migration holds the lock.
 */
export async function runStorageMigration(options: StorageMigrationOptions = {}): Promise<MigrationSummary> {
  const {
    force = false,
    dryRun = false,
    user,
    assumeQuiesced = false,
    ownerId = `migrate-${process.pid}`,
    now = Date.now,
    isDeleted = isUserDeleted,
  } = options;

  const backend = options.backend ?? resolveStorageBackend();
  if (backend === 'file' && !assumeQuiesced) {
    throw new StorageMigrationRefusedError();
  }

  const startedAt = new Date(now()).toISOString();
  const counts: MigrationCounts = {
    inserted: 0,
    overwritten: 0,
    unchanged: 0,
    skippedDivergent: 0,
    skippedCorrupt: 0,
    failures: 0,
  };

  // Acquire the advisory lock BEFORE constructing the store or enumerating
  // users, so a second operator is refused before doing any shared-state work.
  const lock = dryRun ? null : await acquireLock(ownerId, now);
  try {
    const store = options.store ?? (await getDocumentStore());
    const descriptors = allDescriptors();
    const userIds = await excludeTombstonedUsers(await enumerateUsers(user), isDeleted);

    const registeredUsers = new Set<string>();
    let usersProcessed = 0;
    for (const userId of userIds) {
      // Re-check the tombstone per user: a deletion can land AFTER the up-front
      // excludeTombstonedUsers filter but before we reach this user's documents.
      // This cheap early-out skips enumeration entirely for the common case.
      if (await isDeleted(userId)) {
        log.warn('Skipping user tombstoned before processing', { userId });
        continue;
      }
      // A deletion can also land DURING this user's document iteration. Re-check
      // immediately before each write so the very next write is the last one;
      // reads taken before the flip are harmless because the importer never
      // mutates legacy data. Correctness beats the per-document tombstone-stat
      // cost here: migration runs assumeQuiesced as a one-shot operational tool.
      let tombstonedMidRun = false;
      for (const descriptor of descriptors) {
        if (tombstonedMidRun) break;
        const ids = await descriptor.enumerateIds(userId);
        for (const id of ids) {
          let sourceBody: unknown;
          try {
            sourceBody = await descriptor.loadLegacyBody(userId, id);
          } catch (error) {
            // A malformed legacy record (e.g. a workspace sidecar with a
            // non-string filename) must not abort the whole run.
            counts.skippedCorrupt += 1;
            log.warn('Skipping unreadable legacy document', {
              container: descriptor.container,
              id,
              error: error instanceof Error ? error.message : String(error),
            });
            continue;
          }
          if (sourceBody === null) {
            counts.skippedCorrupt += 1;
            continue;
          }
          if (dryRun) {
            await previewDocument(store, counts, descriptor.container, userId, id, sourceBody, force);
            continue;
          }
          if (await isDeleted(userId)) {
            log.warn('Stopping writes for user tombstoned mid-run', { userId });
            tombstonedMidRun = true;
            break;
          }
          if (!registeredUsers.has(userId)) {
            await ensureUserRegistered(store, userId);
            registeredUsers.add(userId);
          }
          try {
            await migrateDocument(store, counts, descriptor.container, userId, id, sourceBody, force);
          } catch (error) {
            counts.failures += 1;
            log.error('Unexpected error migrating document; continuing', {
              container: descriptor.container,
              id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      // Count only users who finished without a mid-run tombstone interrupting
      // their writes. Dry runs never reach the pre-write re-check, so they stay
      // counted as before.
      if (!tombstonedMidRun) {
        usersProcessed += 1;
      }
    }

    const summary: MigrationSummary = {
      dryRun,
      backend,
      usersProcessed,
      counts,
      status: deriveStatus(counts),
      startedAt,
      completedAt: new Date(now()).toISOString(),
    };
    if (!dryRun) {
      await writeStateDocument(store, summary);
    }
    return summary;
  } finally {
    if (lock !== null) {
      await releaseLock(lock);
    }
  }
}
