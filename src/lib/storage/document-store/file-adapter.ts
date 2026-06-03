/**
 * File-backed {@link DocumentStore} adapter.
 *
 * This is the default backend and the migration source for the eventual
 * SQLite/Cosmos backends. It stores each document as a JSON **envelope**
 * (`{ body, metadata, etag, updatedAt }`) at
 * `${DATA_DIR}/_docstore/{container}/{partitionKey}/{id}.json`, wrapping the
 * low-level atomic-write primitives in `../utils`.
 *
 * CAS guarantees differ by write kind. Create-only writes (`ifNoneMatch: '*'`)
 * are **atomic**: they go through an OS-level exclusive create, so two racing
 * first-writers can never both win — exactly what enrollment-slot claims rely
 * on. Compare-and-set updates (`ifMatch: etag`) and single-document `remove`s
 * serialise through a **process-wide** per-document lock (keyed by the
 * symlink-canonical data dir + document path, see {@link withDocumentLock}), so
 * the read-check-write critical section is atomic against every other writer in
 * the same process — including writers issued through a SEPARATE
 * `FileDocumentStore` instance pointed at the same `dataDir`, even when the two
 * instances spell that directory differently (a symlink, or `/tmp` vs
 * `/private/tmp`). Two concurrent stale-etag updates can never both win, a
 * concurrent `remove` can never resurrect a deleted document via a stale write,
 * and `enroll()`'s active-slot reclaim resolves to a single winner on this
 * backend. Bulk deletes (`removeByParent`, `deletePartition`) are teardown
 * operations and are deliberately NOT serialised against single-document
 * writes; callers must not race them against live writes to the same partition.
 * Cross-process / networked-filesystem atomicity remains out of scope — that is
 * the SQLite backend's job (its `BEGIN IMMEDIATE` transaction closes the gap for
 * every client). `etag` is a fresh uuid on every write, never a content hash, so
 * an identical rewrite still advances the token — matching what SQLite and
 * Cosmos do. See `files/v20-storage-and-tracks-plan.md` §A.3.
 *
 * @module storage/document-store/file-adapter
 */

import 'server-only';
import { randomUUID } from 'crypto';
import { mkdirSync, realpathSync } from 'fs';

import { logger } from '@/lib/logger';
import { createStorageFileOps, type StorageFileOps } from '../scoped-file-ops';
import { SAFE_PATH_SEGMENT } from '../user-scope';
import { resolveDataDir } from '../utils';
import { assertExclusiveCas, canonicalizeMetadata, decodeCursor, encodeCursor } from './canonical';
import {
  DocumentConflictError,
  type ContainerName,
  type DocumentEnvelope,
  type DocumentMetadata,
  type DocumentStore,
  type ListOptions,
  type ListResult,
  type PutOptions,
} from './types';

const log = logger.withTag('FileDocumentStore');

/** Root subdirectory (under the data dir) holding all document-store data. */
const DOCSTORE_ROOT = '_docstore';

/** Permissions on every created document-store directory (owner-only). */
const DIR_MODE = 0o700;

/** The on-disk shape: id/partitionKey are derived from the path, not stored. */
interface StoredEnvelope<T> {
  body: T;
  metadata: DocumentMetadata;
  etag: string;
  updatedAt: string;
}

/**
 * Validate a path component against the same conservative allow-list the
 * user-scope helpers use, so a container/partition/id can never introduce a
 * separator, `..`, or other traversal vector below {@link DOCSTORE_ROOT}.
 */
function assertSafeSegment(label: string, value: string): void {
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(`FileDocumentStore: unsafe ${label} segment "${value}"`);
  }
}

/** The subdirectory holding one partition's documents. */
function partitionDir(container: ContainerName, partitionKey: string): string {
  assertSafeSegment('container', container);
  assertSafeSegment('partitionKey', partitionKey);
  return `${DOCSTORE_ROOT}/${container}/${partitionKey}`;
}

/** The `${id}.json` filename for one document. */
function documentFilename(id: string): string {
  assertSafeSegment('id', id);
  return `${id}.json`;
}

/** The ordering value used for `list` sorting, per the requested `orderBy`. */
function orderValueOf<T>(envelope: DocumentEnvelope<T>, orderBy: 'updatedAt' | 'sortKey'): string {
  if (orderBy === 'sortKey') return envelope.metadata.sortKey ?? '';
  return envelope.updatedAt;
}

/**
 * Process-wide async-mutex registry, keyed by `${canonicalRoot}\0${container}/
 * ${partitionKey}/${id}`. Module scope (NOT per-instance) is deliberate: the
 * single-winner `ifMatch` reclaim invariant must hold across every
 * `FileDocumentStore` in the process, so two instances pointed at the same
 * `dataDir` serialise writes to the same physical document. Keying by the
 * symlink-canonical root keeps stores rooted at different directories fully
 * independent while still collapsing two spellings of the same directory.
 */
const documentWriteLocks = new Map<string, Promise<void>>();

/**
 * Collapse symlinks and case aliases in `resolvedRoot` so two stores that
 * resolve to the same PHYSICAL directory via different spellings (a symlink, or
 * `/tmp` vs `/private/tmp` on macOS) share one lock key.
 *
 * STRICT by design: `realpathSync.native` only resolves a path that exists, and
 * {@link FileDocumentStore.#lockedIo} always materialises the root immediately
 * before calling this. If a concurrent unlink/retarget removes the root in that
 * window, the throw propagates (fail closed) rather than degrading to a lexical
 * key that could re-open the dual-winner CAS race.
 */
export function canonicalRootForLockKey(resolvedRoot: string): string {
  return realpathSync.native(resolvedRoot);
}

/**
 * Run `work` while holding the exclusive lock for `lockKey`, releasing it (and
 * evicting the registry entry when no writer is queued behind us) even if `work`
 * throws. Each value in {@link documentWriteLocks} is the tail of a promise
 * chain; a writer awaits the current tail, then appends its own release promise,
 * so `put`s to one document run strictly one at a time. The tail is registered
 * synchronously (before the first `await`), closing the window where two callers
 * could both read an empty slot. Reads are not locked — only writes contend.
 */
export async function withDocumentLock<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
  const predecessor = documentWriteLocks.get(lockKey) ?? Promise.resolve();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = predecessor.then(() => held);
  documentWriteLocks.set(lockKey, tail);

  await predecessor;
  try {
    return await work();
  } finally {
    release();
    if (documentWriteLocks.get(lockKey) === tail) {
      documentWriteLocks.delete(lockKey);
    }
  }
}

/**
 * Read and decode the stored envelope for one document through the given `ops`,
 * or null when the file is absent. Shared by {@link FileDocumentStore.getEnvelope}
 * and the read-check inside {@link FileDocumentStore.put} so both decode alike.
 */
async function readEnvelopeWith<T>(
  ops: StorageFileOps,
  container: ContainerName,
  partitionKey: string,
  id: string,
): Promise<DocumentEnvelope<T> | null> {
  const raw = await ops.readFile(partitionDir(container, partitionKey), documentFilename(id));
  if (raw === null) return null;

  const stored = JSON.parse(raw) as StoredEnvelope<T>;
  return {
    id,
    partitionKey,
    etag: stored.etag,
    updatedAt: stored.updatedAt,
    metadata: stored.metadata ?? {},
    body: stored.body,
  };
}

/**
 * The file-backed document store. Construct one per process via
 * {@link createFileDocumentStore}.
 *
 * Each instance binds its filesystem operations to its OWN `dataDir` (defaulting
 * to the process storage root), so two stores pointed at different directories
 * never collide. The instance holds no mutable state of its own; write
 * serialisation lives in the process-wide {@link documentWriteLocks} registry,
 * keyed by the store's symlink-canonical root so concurrent writers reach the
 * same lock even when issued through different instances over the same `dataDir`
 * — including when those instances spell the directory differently. The
 * canonical root is recomputed at every write (not cached at construction) and
 * bound to BOTH the lock key and the file I/O ({@link #lockedIo}), so the key
 * always tracks the directory the syscalls hit even if a symlink in the
 * configured path is retargeted mid-process, and a write can never hold the lock
 * for one physical directory while writing another.
 */
class FileDocumentStore implements DocumentStore {
  readonly #ops: StorageFileOps;

  /**
   * Data-dir root exactly as configured (resolved but NOT symlink-canonical).
   * {@link #lockedIo} canonicalizes this per write to derive both the
   * {@link documentWriteLocks} namespace and the I/O root.
   */
  readonly #ioRoot: string;

  /**
   * @param dataDir - Base directory for this store's `_docstore` tree; defaults
   *   to the process storage root via {@link resolveDataDir}.
   */
  constructor(dataDir?: string) {
    const root = resolveDataDir(dataDir);
    this.#ops = createStorageFileOps(() => root);
    this.#ioRoot = root;
  }

  /**
   * Resolve the symlink-canonical root once for a single write and bind both the
   * lock key and the file I/O to it, closing the residual TOCTOU window: a
   * realpath has no symlinks left to re-resolve, so a mid-op retarget cannot
   * split lock namespace from write target. The root is materialised FIRST, then
   * canonicalized with a STRICT realpath (no walk-up fallback) so a concurrent
   * unlink/retarget in the post-mkdir window fails closed instead of yielding a
   * partly lexical key. When the root is already canonical the instance ops are
   * reused; otherwise a thin ops bound to the canonical root is created for this
   * write only, so the instance keeps holding no mutable state.
   */
  #lockedIo(container: ContainerName, partitionKey: string, id: string): { lockKey: string; ops: StorageFileOps } {
    mkdirSync(this.#ioRoot, { recursive: true, mode: DIR_MODE });
    const canonicalRoot = canonicalRootForLockKey(this.#ioRoot);
    const ops = canonicalRoot === this.#ioRoot ? this.#ops : createStorageFileOps(() => canonicalRoot);
    return { lockKey: `${canonicalRoot}\u0000${container}/${partitionKey}/${id}`, ops };
  }

  async get<T>(container: ContainerName, partitionKey: string, id: string): Promise<T | null> {
    const envelope = await this.getEnvelope<T>(container, partitionKey, id);
    return envelope ? envelope.body : null;
  }

  async getEnvelope<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
  ): Promise<DocumentEnvelope<T> | null> {
    return readEnvelopeWith<T>(this.#ops, container, partitionKey, id);
  }

  async put<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
    body: T,
    opts: PutOptions = {},
  ): Promise<DocumentEnvelope<T>> {
    assertExclusiveCas(opts);
    const dir = partitionDir(container, partitionKey);
    const filename = documentFilename(id);
    const stored: StoredEnvelope<T> = {
      body,
      metadata: canonicalizeMetadata(opts.metadata),
      etag: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(stored, null, 2);

    // Serialise all writes to this exact document so the read-check-write below
    // is atomic against concurrent in-process writers (see class docs). The lock
    // key and I/O ops are both bound to the canonical root, so two instances over
    // the same dataDir share the lock AND write the same physical file.
    const { lockKey, ops } = this.#lockedIo(container, partitionKey, id);
    return withDocumentLock(lockKey, async () => {
      // Create-only writes take an atomic exclusive-create path: the OS guarantees
      // exactly one of two racing first-writers succeeds, so `ifNoneMatch: '*'`
      // confers true uniqueness instead of the read-then-rename TOCTOU the upsert
      // path carries. The loser observes EEXIST and surfaces a conflict.
      if (opts.ifNoneMatch === '*') {
        const created = await ops.createFileExclusive(dir, filename, serialized);
        if (!created) {
          throw new DocumentConflictError(`document ${container}/${partitionKey}/${id} already exists`);
        }
        return { id, partitionKey, ...stored };
      }

      const existing = await readEnvelopeWith<T>(ops, container, partitionKey, id);
      if (opts.ifMatch !== undefined && (!existing || existing.etag !== opts.ifMatch)) {
        throw new DocumentConflictError(
          `etag mismatch for ${container}/${partitionKey}/${id} (expected ${opts.ifMatch})`,
        );
      }

      await ops.ensureDir(dir, { mode: DIR_MODE });
      await ops.writeFile(dir, filename, serialized);

      return { id, partitionKey, ...stored };
    });
  }

  /**
   * Delete one document, idempotently. Holds the same per-document lock as
   * {@link put}, so a `remove` racing a stale `ifMatch` update can never let the
   * losing writer resurrect the document: the two serialise, and whichever runs
   * second observes the other's committed state — a `put` running second finds
   * an absent doc and its etag check fails; a `remove` running second finds the
   * written doc and deletes it. Either ordering ends with no document.
   */
  async remove(container: ContainerName, partitionKey: string, id: string): Promise<void> {
    const { lockKey, ops } = this.#lockedIo(container, partitionKey, id);
    await withDocumentLock(lockKey, async () => {
      await ops.deleteFile(partitionDir(container, partitionKey), documentFilename(id));
    });
  }

  async list<T>(container: ContainerName, partitionKey: string, opts: ListOptions = {}): Promise<ListResult<T>> {
    const envelopes = await this.readPartition<T>(container, partitionKey);
    const filtered = envelopes.filter((envelope) => matchesFilters(envelope, opts));

    const orderBy = opts.orderBy ?? 'updatedAt';
    const direction = opts.direction ?? 'asc';
    filtered.sort((left, right) => compareForOrder(left, right, orderBy, direction));

    const afterCursor = applyCursor(filtered, opts.cursor, orderBy, direction);
    if (opts.limit === undefined || afterCursor.length <= opts.limit) {
      return { items: afterCursor };
    }

    const page = afterCursor.slice(0, opts.limit);
    const lastItem = page[page.length - 1];
    return {
      items: page,
      nextCursor: encodeCursor(orderValueOf(lastItem, orderBy), lastItem.id),
    };
  }

  /**
   * Delete every document whose `parentId` metadata matches. This is a teardown
   * operation and is NOT serialised against single-document writes via
   * {@link documentWriteLocks}; callers must not race it against live `put`s to
   * the same partition (see class docs).
   */
  async removeByParent(container: ContainerName, partitionKey: string, parentId: string): Promise<void> {
    const envelopes = await this.readPartition(container, partitionKey);
    const targets = envelopes.filter((envelope) => envelope.metadata.parentId === parentId);
    for (const target of targets) {
      await this.#ops.deleteFile(partitionDir(container, partitionKey), documentFilename(target.id));
    }
  }

  /**
   * Delete an entire partition directory. Like {@link removeByParent} this is a
   * teardown operation and is NOT serialised against single-document writes;
   * callers must not race it against live `put`s to the same partition.
   */
  async deletePartition(container: ContainerName, partitionKey: string): Promise<void> {
    await this.#ops.deleteDir(partitionDir(container, partitionKey));
  }

  /** Read and parse every envelope in a partition (skips no files). */
  private async readPartition<T>(container: ContainerName, partitionKey: string): Promise<DocumentEnvelope<T>[]> {
    const dir = partitionDir(container, partitionKey);
    const filenames = await this.#ops.listFiles(dir);
    const envelopes: DocumentEnvelope<T>[] = [];
    for (const filename of filenames) {
      if (!filename.endsWith('.json')) continue;
      const id = filename.slice(0, -'.json'.length);
      const envelope = await this.getEnvelope<T>(container, partitionKey, id);
      if (envelope) envelopes.push(envelope);
    }
    return envelopes;
  }
}

/** True when an envelope satisfies every supplied indexed filter. */
function matchesFilters<T>(envelope: DocumentEnvelope<T>, opts: ListOptions): boolean {
  if (opts.type !== undefined && envelope.metadata.type !== opts.type) return false;
  if (opts.status !== undefined && envelope.metadata.status !== opts.status) return false;
  if (opts.parentId !== undefined && envelope.metadata.parentId !== opts.parentId) return false;
  return true;
}

/** Compare two envelopes by `(orderValue, id)` honouring the sort direction. */
function compareForOrder<T>(
  left: DocumentEnvelope<T>,
  right: DocumentEnvelope<T>,
  orderBy: 'updatedAt' | 'sortKey',
  direction: 'asc' | 'desc',
): number {
  const leftOrder = orderValueOf(left, orderBy);
  const rightOrder = orderValueOf(right, orderBy);
  let comparison = leftOrder < rightOrder ? -1 : leftOrder > rightOrder ? 1 : 0;
  if (comparison === 0) {
    comparison = left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }
  return direction === 'desc' ? -comparison : comparison;
}

/** Drop everything up to and including the cursor position. */
function applyCursor<T>(
  sorted: DocumentEnvelope<T>[],
  cursor: string | undefined,
  orderBy: 'updatedAt' | 'sortKey',
  direction: 'asc' | 'desc',
): DocumentEnvelope<T>[] {
  if (!cursor) return sorted;
  const decoded = decodeCursor(cursor);
  if (!decoded) return sorted;

  return sorted.filter((envelope) => {
    const order = orderValueOf(envelope, orderBy);
    const afterAscending = order > decoded.orderValue || (order === decoded.orderValue && envelope.id > decoded.id);
    const afterDescending = order < decoded.orderValue || (order === decoded.orderValue && envelope.id < decoded.id);
    return direction === 'desc' ? afterDescending : afterAscending;
  });
}

/** Options for {@link createFileDocumentStore}. */
export interface CreateFileDocumentStoreOptions {
  /**
   * Base directory for this store's `_docstore` tree. Defaults to the process
   * storage root; pass an explicit value to point a store at its own directory
   * (e.g. so the storage factory's `dataDir` override actually takes effect).
   */
  dataDir?: string;
}

/** Construct a file-backed document store, optionally rooted at `dataDir`. */
export function createFileDocumentStore(options: CreateFileDocumentStoreOptions = {}): DocumentStore {
  log.debug('Created file-backed document store');
  return new FileDocumentStore(options.dataDir);
}
