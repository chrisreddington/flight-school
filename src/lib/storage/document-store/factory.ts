/**
 * The storage-backend factory (§0.1, §0.5).
 *
 * One place resolves which backend a process runs (`file` by default, `sqlite`
 * opt-in via `STORAGE_BACKEND`), reconciles the on-disk sentinel so two
 * processes can never split-brain on different backends, and constructs the
 * matching {@link DocumentStore}. Domain code depends only on the
 * `DocumentStore` interface, so swapping backends — or adding Cosmos DB later —
 * never reaches past this module.
 *
 * Critical load-order invariant: the `sqlite` adapter is reached through a
 * dynamic `import()` taken ONLY after the backend resolves to `sqlite` and the
 * Node version is validated. Nothing on the static import graph of this module
 * pulls in `node:sqlite`, so the default `file` path keeps working on Node
 * versions where that driver is unavailable.
 */

import path from 'path';

import { getStorageRoot } from '../utils';
import { reconcileBackendSentinel, type StorageBackend } from './backend-sentinel';
import { createFileDocumentStore } from './file-adapter';
import type { DocumentStore } from './types';

/** Database filename for the sqlite backend, placed under the data dir. */
const SQLITE_DB_FILENAME = '_docstore.sqlite';

/**
 * Minimum Node version (major, minor, patch) whose `node:sqlite` we depend on.
 * 22.13 is the first LTS line that ships `DatabaseSync` with the WAL + busy
 * timeout behaviour the adapter relies on.
 */
const MIN_SQLITE_NODE: readonly [number, number, number] = [22, 13, 0];

/**
 * Resolve the desired backend from an env value, defaulting to `file`.
 *
 * An unrecognised value throws rather than silently defaulting: a typo in
 * `STORAGE_BACKEND` should fail loudly at startup, not quietly run the wrong
 * store.
 */
export function resolveStorageBackend(raw = process.env.STORAGE_BACKEND): StorageBackend {
  const value = raw?.trim().toLowerCase();
  if (!value || value === 'file') return 'file';
  if (value === 'sqlite') return 'sqlite';
  throw new Error(`Unsupported STORAGE_BACKEND "${raw}" (expected "file" or "sqlite")`);
}

/**
 * Throw unless the running Node version can load the sqlite driver.
 *
 * Parsed lexicographically over (major, minor, patch); any trailing
 * pre-release suffix is ignored so `22.13.0-nightly` compares as `22.13.0`.
 */
export function assertNodeSupportsSqlite(nodeVersion = process.versions.node): void {
  const parts = nodeVersion.split('.').map((segment) => Number.parseInt(segment, 10));
  for (let index = 0; index < MIN_SQLITE_NODE.length; index += 1) {
    const have = Number.isNaN(parts[index]) ? 0 : parts[index];
    const need = MIN_SQLITE_NODE[index];
    if (have > need) return;
    if (have < need) {
      const required = MIN_SQLITE_NODE.join('.');
      throw new Error(`STORAGE_BACKEND=sqlite requires Node >= ${required}, but this process is ${nodeVersion}`);
    }
  }
}

/** Options for {@link createDocumentStore}; both default to process config. */
export interface CreateDocumentStoreOptions {
  /** Override the resolved backend (defaults to {@link resolveStorageBackend}). */
  backend?: StorageBackend;
  /** Override the data directory (defaults to {@link getStorageRoot}). */
  dataDir?: string;
}

/**
 * Construct the process's {@link DocumentStore} for the selected backend.
 *
 * The sentinel is reconciled before any adapter opens, so a backend mismatch
 * throws before a connection or file handle is created.
 */
export async function createDocumentStore(options: CreateDocumentStoreOptions = {}): Promise<DocumentStore> {
  const dataDir = options.dataDir ?? getStorageRoot();
  const backend = options.backend ?? resolveStorageBackend();

  await reconcileBackendSentinel({ dataDir, backend });

  if (backend === 'file') {
    return createFileDocumentStore({ dataDir });
  }

  assertNodeSupportsSqlite();
  const { createSqliteDocumentStore } = await import('./sqlite-adapter');
  return createSqliteDocumentStore({ dbPath: path.join(dataDir, SQLITE_DB_FILENAME) });
}

let documentStorePromise: Promise<DocumentStore> | null = null;

/**
 * The process-wide document store, constructed once and memoised.
 *
 * The promise is cached (not the resolved value) so concurrent first callers
 * share a single construction — and a single sentinel reconciliation — instead
 * of racing to open two stores.
 *
 * A rejected construction is NOT cached: if the first attempt fails (a
 * transient sentinel-reconciliation error, say), the memoised promise is
 * cleared so the next caller retries from scratch rather than inheriting a
 * permanently-poisoned rejection for the life of the process.
 */
export function getDocumentStore(): Promise<DocumentStore> {
  if (!documentStorePromise) {
    const pending = createDocumentStore();
    documentStorePromise = pending;
    pending.catch(() => {
      if (documentStorePromise === pending) documentStorePromise = null;
    });
  }
  return documentStorePromise;
}
