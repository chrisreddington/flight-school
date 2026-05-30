/**
 * The backend-agnostic document-store contract.
 *
 * Flight School's storage is modelled as a per-user **partitioned document
 * store** — the shape Cosmos DB exposes natively (containers of items keyed
 * by `(partitionKey, id)`) and the shape SQLite emulates with a single
 * `documents` table. App code never calls this interface directly; thin
 * domain repositories (skills, habits, tracks, …) sit above it, and a
 * user-scoped wrapper bakes in the tenant partition key so a caller can
 * never reach another user's data.
 *
 * Metadata lives OUTSIDE the body: `get()` returns the unwrapped domain
 * shape, while `getEnvelope()`/`list()` surface the concurrency token and the
 * four indexed fields. See `files/v20-storage-and-tracks-plan.md` §A.1.
 *
 * @module storage/document-store/types
 */

/**
 * Canonical id for a container that holds exactly one document per user
 * (skills, habits, focus). Self-documenting rather than a bare `'current'`.
 */
export const SINGLETON_DOCUMENT_ID = 'current';

/**
 * Thrown by {@link DocumentStore.put} when an `ifMatch`/`ifNoneMatch` CAS
 * condition fails — the item already exists for `ifNoneMatch:'*'`, or the
 * etag no longer matches for `ifMatch`. This is the ONLY error a caller may
 * treat as "lost a benign create/update race"; every other thrown error is a
 * genuine storage failure that must propagate.
 */
export class DocumentConflictError extends Error {
  readonly code = 'DOCUMENT_CONFLICT';

  constructor(message = 'document CAS condition failed') {
    super(message);
    this.name = 'DocumentConflictError';
  }
}

/**
 * A logical grouping of documents (≈ a Cosmos container / a slice of the
 * SQLite `documents` table). The `system` container holds cross-cutting
 * global state (tombstones, migration-state, the user-registry) — but NOT
 * the backend sentinel, which is a raw file outside any store (§0.5).
 */
export type ContainerName =
  | 'skills'
  | 'habits'
  | 'focus'
  | 'profile'
  | 'challenges'
  | 'challenge-queue'
  | 'threads'
  | 'evaluations'
  | 'activity'
  | 'workspaces'
  | 'track-enrollments'
  | 'track-steps'
  | 'system';

/**
 * The indexed metadata surface — the ONLY queryable attributes. Keeping the
 * query surface this narrow keeps the design single-partition-friendly and
 * maps cleanly to Cosmos (where ad-hoc secondary indexes carry RU cost).
 */
export interface DocumentMetadata {
  type?: string;
  status?: string;
  parentId?: string;
  sortKey?: string;
}

/**
 * A stored document with its metadata kept outside the domain body.
 *
 * `etag` is an opaque, always-advancing concurrency token regenerated on
 * every successful `put` (file: a fresh uuid; sqlite: a stringified
 * monotonic rowversion; cosmos: the native `_etag`). It is NEVER a content
 * hash — a hash would stay constant across an identical rewrite, which
 * sqlite and Cosmos cannot replicate, breaking cross-adapter CAS parity.
 */
export interface DocumentEnvelope<T> {
  id: string;
  partitionKey: string;
  etag: string;
  updatedAt: string;
  metadata: DocumentMetadata;
  body: T;
}

/** Options accepted by {@link DocumentStore.put}. */
export interface PutOptions {
  /** Update only if the stored etag still equals this token (CAS). */
  ifMatch?: string;
  /** Create only if the document is absent. */
  ifNoneMatch?: '*';
  /** Populate the indexed columns so `list` can filter/order. */
  metadata?: DocumentMetadata;
}

/** Options accepted by {@link DocumentStore.list}. */
export interface ListOptions {
  type?: string;
  status?: string;
  parentId?: string;
  limit?: number;
  cursor?: string;
  orderBy?: 'updatedAt' | 'sortKey';
  direction?: 'asc' | 'desc';
}

/** A page of envelopes plus an opaque cursor for the next page. */
export interface ListResult<T> {
  items: DocumentEnvelope<T>[];
  nextCursor?: string;
}

/**
 * The backend-agnostic storage contract. Implemented by the file adapter
 * (back-compat + migration source) and the sqlite adapter; Cosmos maps onto
 * the same shape. Raw stores take an explicit `partitionKey` and are
 * INTERNAL — domain code only ever sees the user-scoped wrapper.
 */
export interface DocumentStore {
  /**
   * Read-only point read returning the unwrapped body (null if absent). No
   * side effects — no create-default, no self-heal. Use {@link getEnvelope}
   * when you intend a CAS read-mutate-write.
   */
  get<T>(container: ContainerName, partitionKey: string, id: string): Promise<T | null>;

  /**
   * Read the full envelope (body + etag + metadata), null if absent. Call
   * before a CAS write so the returned `etag` can be passed as `ifMatch`.
   */
  getEnvelope<T>(container: ContainerName, partitionKey: string, id: string): Promise<DocumentEnvelope<T> | null>;

  /**
   * Upsert with optional optimistic concurrency and indexed metadata. A
   * failed `ifMatch`/`ifNoneMatch` condition throws {@link DocumentConflictError};
   * callers decide whether to treat it as benign.
   */
  put<T>(
    container: ContainerName,
    partitionKey: string,
    id: string,
    body: T,
    opts?: PutOptions,
  ): Promise<DocumentEnvelope<T>>;

  /** Delete a single document. Idempotent (absent id = success). */
  remove(container: ContainerName, partitionKey: string, id: string): Promise<void>;

  /**
   * Every document in a partition, with optional indexed filters and
   * ordering. The pagination tie-break is the stable composite of the
   * ordering column and `id`, so equal leading values still page
   * deterministically.
   */
  list<T>(container: ContainerName, partitionKey: string, opts?: ListOptions): Promise<ListResult<T>>;

  /**
   * Delete every document in a partition whose `parentId` matches — the
   * scoped delete the re-enroll prune and per-parent cleanup need.
   * Idempotent: zero matching rows is success.
   */
  removeByParent(container: ContainerName, partitionKey: string, parentId: string): Promise<void>;

  /** Wipe one partition in one container (retention + account deletion). */
  deletePartition(container: ContainerName, partitionKey: string): Promise<void>;
}
