/**
 * SQLite-backed {@link DocumentStore} adapter.
 *
 * This is the parity backend the file adapter migrates toward. It models the
 * partitioned document store as a single `documents` table keyed by
 * `(container, partition_key, id)`, with the four indexed metadata fields
 * promoted to columns so `list` can filter/order through real indexes. See
 * `files/v20-storage-and-tracks-plan.md` §A.2/§A.3.
 *
 * Unlike the file adapter, CAS here is **race-free**: the read-then-write in
 * `put` runs inside a `BEGIN IMMEDIATE` transaction, so a competing writer
 * cannot slip in between the etag check and the upsert. `etag` is a monotonic
 * integer surfaced as a string — it advances on every write, including an
 * identical rewrite, matching the file (uuid) and Cosmos (`_etag`) backends.
 *
 * The driver (`node:sqlite`) is loaded lazily via {@link loadDatabaseSync} so
 * importing this module never requires it; only constructing a store does.
 * That keeps the file backend free of any `node:sqlite` dependency on older
 * Node versions where the module is unavailable.
 *
 * @module storage/document-store/sqlite-adapter
 */

import 'server-only';

// `import type` is erased at compile time, so this never emits a runtime
// require of `node:sqlite`; the real module is loaded lazily below.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import { logger } from '@/lib/logger';
import { SAFE_PATH_SEGMENT } from '../user-scope';
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

const log = logger.withTag('SqliteDocumentStore');

/** Constructor shape of `node:sqlite`'s `DatabaseSync`, loaded at runtime. */
type DatabaseSyncConstructor = new (path: string) => DatabaseSync;

/** Options for {@link createSqliteDocumentStore}. */
export interface SqliteDocumentStoreOptions {
  /** Filesystem path to the SQLite database file. */
  dbPath: string;
}

/**
 * One row of the `documents` table as `node:sqlite` returns it. Integer
 * columns come back as JS numbers; nullable metadata columns as `null`.
 */
interface DocumentRow {
  id: string;
  body: string;
  etag: number;
  updated_at: string;
  type: string | null;
  status: string | null;
  parent_id: string | null;
  sort_key: string | null;
}

/**
 * Schema for a fresh database: the `documents` table, the two covering
 * indexes (both trailing `id` so pagination tie-breaks stay index-covered),
 * and a single-row counter that hands out monotonic etags.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  container TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  etag INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  type TEXT,
  status TEXT,
  parent_id TEXT,
  sort_key TEXT,
  PRIMARY KEY (container, partition_key, id)
);
CREATE INDEX IF NOT EXISTS idx_documents_partition
  ON documents (container, partition_key, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_documents_parent
  ON documents (container, partition_key, parent_id, sort_key, id);
CREATE TABLE IF NOT EXISTS etag_sequence (
  rowid INTEGER PRIMARY KEY CHECK (rowid = 1),
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO etag_sequence (rowid, value) VALUES (1, 0);
`;

/**
 * Lazily load `node:sqlite`'s `DatabaseSync`, suppressing only its
 * `ExperimentalWarning` for the duration of the import.
 *
 * The suppression is deliberately narrow: a wrapper around `process.emit`
 * swallows exactly the `node:sqlite` experimental warning and re-emits every
 * other event, and the original `process.emit` is restored in `finally` so no
 * genuine warning is ever lost — even if the import throws.
 *
 * The result is memoised so the `process.emit` suppression window opens at most
 * once per process: concurrent or repeated store construction shares a single
 * in-flight import and can never leave a wrapper permanently installed by
 * racing each other's restore.
 */
let databaseSyncCtorPromise: Promise<DatabaseSyncConstructor> | null = null;

function loadDatabaseSync(): Promise<DatabaseSyncConstructor> {
  if (databaseSyncCtorPromise) return databaseSyncCtorPromise;

  databaseSyncCtorPromise = (async () => {
    const originalEmit = process.emit.bind(process);
    const isNodeSqliteExperimentalWarning = (event: string, payload: unknown): boolean => {
      if (event !== 'warning') return false;
      const warning = payload as { name?: string; message?: string } | undefined;
      return (
        warning?.name === 'ExperimentalWarning' &&
        typeof warning.message === 'string' &&
        warning.message.includes('node:sqlite')
      );
    };

    process.emit = function suppressNodeSqliteWarning(event: string, ...args: unknown[]): boolean {
      if (isNodeSqliteExperimentalWarning(event, args[0])) return false;
      return (originalEmit as (...emitArgs: unknown[]) => boolean)(event, ...args);
    } as typeof process.emit;

    try {
      const sqlite = await import('node:sqlite');
      return sqlite.DatabaseSync as unknown as DatabaseSyncConstructor;
    } finally {
      process.emit = originalEmit;
    }
  })();

  return databaseSyncCtorPromise;
}

/**
 * Run `work` inside a `BEGIN IMMEDIATE` transaction, committing on success and
 * rolling back on any thrown error.
 *
 * The callback MUST be synchronous: an awaited callback would let `COMMIT` run
 * before the work finished and hold the write lock across IO. This helper is
 * also NOT re-entrant — a nested `BEGIN IMMEDIATE` throws — so compose
 * multi-write operations from row-level helpers, never from nested `put`s.
 */
function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Validate a key segment against the same conservative allow-list the file
 * adapter enforces on its path components, so container/partition/id inputs are
 * rejected identically across backends — a segment that would throw on the file
 * store must also throw here, never silently succeed.
 */
function assertSafeSegment(label: string, value: string): void {
  if (!SAFE_PATH_SEGMENT.test(value)) {
    throw new Error(`SqliteDocumentStore: unsafe ${label} segment "${value}"`);
  }
}

/** The ordering value used for `list` sorting, per the requested `orderBy`. */
function orderValueOf<T>(envelope: DocumentEnvelope<T>, orderBy: 'updatedAt' | 'sortKey'): string {
  if (orderBy === 'sortKey') return envelope.metadata.sortKey ?? '';
  return envelope.updatedAt;
}

/** Build the indexed-metadata view from a row, omitting null columns. */
function metadataFromRow(row: DocumentRow): DocumentMetadata {
  const metadata: DocumentMetadata = {};
  if (row.type !== null) metadata.type = row.type;
  if (row.status !== null) metadata.status = row.status;
  if (row.parent_id !== null) metadata.parentId = row.parent_id;
  if (row.sort_key !== null) metadata.sortKey = row.sort_key;
  return metadata;
}

/** Reconstruct an envelope from a stored row. */
function rowToEnvelope<T>(row: DocumentRow, partitionKey: string): DocumentEnvelope<T> {
  return {
    id: row.id,
    partitionKey,
    etag: String(row.etag),
    updatedAt: row.updated_at,
    metadata: metadataFromRow(row),
    body: JSON.parse(row.body) as T,
  };
}

const SELECT_COLUMNS = 'id, body, etag, updated_at, type, status, parent_id, sort_key';

const UPSERT_SQL = `
INSERT INTO documents
  (container, partition_key, id, body, etag, updated_at, type, status, parent_id, sort_key)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (container, partition_key, id) DO UPDATE SET
  body = excluded.body,
  etag = excluded.etag,
  updated_at = excluded.updated_at,
  type = excluded.type,
  status = excluded.status,
  parent_id = excluded.parent_id,
  sort_key = excluded.sort_key
`;

/**
 * The SQLite-backed document store. Construct one per process per database via
 * {@link createSqliteDocumentStore}; it owns its connection and holds no other
 * mutable state.
 */
class SqliteDocumentStore implements DocumentStore {
  constructor(private readonly db: DatabaseSync) {}

  async get<T>(container: ContainerName, partitionKey: string, id: string): Promise<T | null> {
    const envelope = await this.getEnvelope<T>(container, partitionKey, id);
    return envelope ? envelope.body : null;
  }

  async getEnvelope<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
  ): Promise<DocumentEnvelope<T> | null> {
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    assertSafeSegment('id', id);
    const row = this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM documents WHERE container = ? AND partition_key = ? AND id = ?`)
      .get(container, partitionKey, id) as DocumentRow | undefined;
    return row ? rowToEnvelope<T>(row, partitionKey) : null;
  }

  async put<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
    body: T,
    opts: PutOptions = {},
  ): Promise<DocumentEnvelope<T>> {
    // CAS-mode validation runs before segment validation so a call that is both
    // malformed (both CAS modes) and has an unsafe segment fails identically to
    // the file adapter — a DocumentConflictError, never the segment error.
    assertExclusiveCas(opts);
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    assertSafeSegment('id', id);
    const metadata = canonicalizeMetadata(opts.metadata);
    const bodyJson = JSON.stringify(body);

    const { etag, updatedAt } = withTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT etag FROM documents WHERE container = ? AND partition_key = ? AND id = ?')
        .get(container, partitionKey, id) as { etag: number } | undefined;

      if (opts.ifNoneMatch === '*' && existing) {
        throw new DocumentConflictError(`document ${container}/${partitionKey}/${id} already exists`);
      }
      if (opts.ifMatch !== undefined && (!existing || String(existing.etag) !== opts.ifMatch)) {
        throw new DocumentConflictError(
          `etag mismatch for ${container}/${partitionKey}/${id} (expected ${opts.ifMatch})`,
        );
      }

      const nextEtag = this.nextEtag();
      const writtenAt = new Date().toISOString();
      this.db
        .prepare(UPSERT_SQL)
        .run(
          container,
          partitionKey,
          id,
          bodyJson,
          nextEtag,
          writtenAt,
          metadata.type ?? null,
          metadata.status ?? null,
          metadata.parentId ?? null,
          metadata.sortKey ?? null,
        );
      return { etag: String(nextEtag), updatedAt: writtenAt };
    });

    return { id, partitionKey, etag, updatedAt, metadata, body };
  }

  async remove(container: ContainerName, partitionKey: string, id: string): Promise<void> {
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    assertSafeSegment('id', id);
    this.db
      .prepare('DELETE FROM documents WHERE container = ? AND partition_key = ? AND id = ?')
      .run(container, partitionKey, id);
  }

  async list<T>(container: ContainerName, partitionKey: string, opts: ListOptions = {}): Promise<ListResult<T>> {
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    const orderBy = opts.orderBy ?? 'updatedAt';
    const direction = opts.direction ?? 'asc';
    const orderColumn = orderBy === 'sortKey' ? "COALESCE(sort_key, '')" : 'updated_at';
    const comparison = direction === 'desc' ? '<' : '>';
    const order = direction === 'desc' ? 'DESC' : 'ASC';

    const conditions = ['container = ?', 'partition_key = ?'];
    const params: SQLInputValue[] = [container, partitionKey];
    if (opts.type !== undefined) {
      conditions.push('type = ?');
      params.push(opts.type);
    }
    if (opts.status !== undefined) {
      conditions.push('status = ?');
      params.push(opts.status);
    }
    if (opts.parentId !== undefined) {
      conditions.push('parent_id = ?');
      params.push(opts.parentId);
    }

    const decoded = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (decoded) {
      conditions.push(`(${orderColumn} ${comparison} ? OR (${orderColumn} = ? AND id ${comparison} ?))`);
      params.push(decoded.orderValue, decoded.orderValue, decoded.id);
    }

    let sql = `SELECT ${SELECT_COLUMNS} FROM documents WHERE ${conditions.join(' AND ')} ORDER BY ${orderColumn} ${order}, id ${order}`;
    if (opts.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(opts.limit + 1);
    }

    const rows = this.db.prepare(sql).all(...params) as unknown as DocumentRow[];
    const envelopes = rows.map((row) => rowToEnvelope<T>(row, partitionKey));

    if (opts.limit === undefined || envelopes.length <= opts.limit) {
      return { items: envelopes };
    }

    const page = envelopes.slice(0, opts.limit);
    const lastItem = page[page.length - 1];
    return {
      items: page,
      nextCursor: encodeCursor(orderValueOf(lastItem, orderBy), lastItem.id),
    };
  }

  async removeByParent(container: ContainerName, partitionKey: string, parentId: string): Promise<void> {
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    this.db
      .prepare('DELETE FROM documents WHERE container = ? AND partition_key = ? AND parent_id = ?')
      .run(container, partitionKey, parentId);
  }

  async deletePartition(container: ContainerName, partitionKey: string): Promise<void> {
    assertSafeSegment('container', container);
    assertSafeSegment('partitionKey', partitionKey);
    this.db.prepare('DELETE FROM documents WHERE container = ? AND partition_key = ?').run(container, partitionKey);
  }

  /**
   * Hand out the next monotonic etag. Only ever called inside a
   * `BEGIN IMMEDIATE` transaction, so the increment-then-read is serialised
   * and two writers can never observe the same value.
   */
  private nextEtag(): number {
    this.db.prepare('UPDATE etag_sequence SET value = value + 1 WHERE rowid = 1').run();
    const row = this.db.prepare('SELECT value FROM etag_sequence WHERE rowid = 1').get() as { value: number };
    return row.value;
  }
}

/**
 * Construct a SQLite-backed document store at `dbPath`, opening the connection
 * in WAL mode with a bounded busy timeout and creating the schema if absent.
 */
export async function createSqliteDocumentStore(options: SqliteDocumentStoreOptions): Promise<DocumentStore> {
  const DatabaseSyncCtor = await loadDatabaseSync();
  const db = new DatabaseSyncCtor(options.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 250');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  log.debug('Created sqlite-backed document store', { dbPath: options.dbPath });
  return new SqliteDocumentStore(db);
}
