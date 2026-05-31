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
 * on. Compare-and-set updates (`ifMatch: etag`) remain **last-write-wins with
 * conflict detection**: the read-then-rename gap is a documented TOCTOU ceiling
 * that only the SQLite backend fully closes (atomicity is scoped to a local
 * filesystem; networked filesystems are out of scope). `etag` is a fresh uuid
 * on every write, never a content hash, so an identical rewrite still advances
 * the token — matching what SQLite and Cosmos do. See
 * `files/v20-storage-and-tracks-plan.md` §A.3.
 *
 * @module storage/document-store/file-adapter
 */

import 'server-only';
import { randomUUID } from 'crypto';

import { logger } from '@/lib/logger';
import { createStorageFileOps, type StorageFileOps } from '../scoped-file-ops';
import { SAFE_PATH_SEGMENT } from '../user-scope';
import { resolveDataDir } from '../utils';
import { canonicalizeMetadata, decodeCursor, encodeCursor } from './canonical';
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
 * The file-backed document store. Construct one per process via
 * {@link createFileDocumentStore}.
 *
 * Each instance binds its filesystem operations to its OWN `dataDir` (defaulting
 * to the process storage root), so two stores pointed at different directories
 * never collide through a shared module global. The instance holds no other
 * mutable state.
 */
class FileDocumentStore implements DocumentStore {
  readonly #ops: StorageFileOps;

  /**
   * @param dataDir - Base directory for this store's `_docstore` tree; defaults
   *   to the process storage root via {@link resolveDataDir}.
   */
  constructor(dataDir?: string) {
    const root = resolveDataDir(dataDir);
    this.#ops = createStorageFileOps(() => root);
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
    const dir = partitionDir(container, partitionKey);
    const raw = await this.#ops.readFile(dir, documentFilename(id));
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

  async put<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
    body: T,
    opts: PutOptions = {},
  ): Promise<DocumentEnvelope<T>> {
    const dir = partitionDir(container, partitionKey);
    const filename = documentFilename(id);
    const stored: StoredEnvelope<T> = {
      body,
      metadata: canonicalizeMetadata(opts.metadata),
      etag: randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const serialized = JSON.stringify(stored, null, 2);

    // Create-only writes take an atomic exclusive-create path: the OS guarantees
    // exactly one of two racing first-writers succeeds, so `ifNoneMatch: '*'`
    // confers true uniqueness instead of the read-then-rename TOCTOU the upsert
    // path carries. The loser observes EEXIST and surfaces a conflict.
    if (opts.ifNoneMatch === '*') {
      const created = await this.#ops.createFileExclusive(dir, filename, serialized);
      if (!created) {
        throw new DocumentConflictError(`document ${container}/${partitionKey}/${id} already exists`);
      }
      return { id, partitionKey, ...stored };
    }

    const existing = await this.getEnvelope<T>(container, partitionKey, id);
    if (opts.ifMatch !== undefined && (!existing || existing.etag !== opts.ifMatch)) {
      throw new DocumentConflictError(
        `etag mismatch for ${container}/${partitionKey}/${id} (expected ${opts.ifMatch})`,
      );
    }

    await this.#ops.ensureDir(dir, { mode: DIR_MODE });
    await this.#ops.writeFile(dir, filename, serialized);

    return { id, partitionKey, ...stored };
  }

  async remove(container: ContainerName, partitionKey: string, id: string): Promise<void> {
    await this.#ops.deleteFile(partitionDir(container, partitionKey), documentFilename(id));
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

  async removeByParent(container: ContainerName, partitionKey: string, parentId: string): Promise<void> {
    const envelopes = await this.readPartition(container, partitionKey);
    const targets = envelopes.filter((envelope) => envelope.metadata.parentId === parentId);
    for (const target of targets) {
      await this.#ops.deleteFile(partitionDir(container, partitionKey), documentFilename(target.id));
    }
  }

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
