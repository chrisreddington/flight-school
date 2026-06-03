/**
 * The backend-neutral storage sentinel (§0.5).
 *
 * Next and the worker are separate processes that each pick a storage backend
 * from `STORAGE_BACKEND`. If they disagree, each would silently read and write
 * its own physical copy of the data — a split brain. The coordination state
 * that prevents this cannot itself live inside the backend being coordinated,
 * so it is a **plain file** at a fixed path, never routed through a
 * `DocumentStore`.
 *
 * Every process reconciles this file **before opening any adapter**:
 *   - absent  → atomically create it (first writer wins), recording the chosen
 *     backend and schema version;
 *   - present → assert the recorded backend and schema version match this
 *     process, refusing to start on any mismatch;
 *   - corrupt → fatal, and the file is left untouched (treating it as absent
 *     would re-open the exact split-brain window this guard closes).
 *
 * Changing the recorded backend is a deliberate, explicit migration (§A.7),
 * not an ad-hoc env change — so normal startup refuses every mismatch.
 *
 * @module storage/document-store/backend-sentinel
 */

import { promises as fs } from 'fs';
import path from 'path';

/** Which physical backend a process has selected. */
export type StorageBackend = 'file' | 'sqlite';

/**
 * On-disk storage format version. Bumped only when the physical layout of the
 * data directory changes in a way that older processes cannot read. The
 * sentinel gates it so a format bump cannot be straddled by two processes.
 */
export const STORAGE_SCHEMA_VERSION = 1;

/** Fixed sentinel filename, relative to the data directory. */
export const SENTINEL_FILENAME = '.storage-backend';

/** The reconciled `{backend, schemaVersion}` pair recorded in the sentinel. */
export interface BackendSentinel {
  backend: StorageBackend;
  schemaVersion: number;
}

/**
 * Thrown when the sentinel records a backend or schema version that does not
 * match the starting process. This is a fatal, deliberate refusal: the only
 * sanctioned way the recorded backend changes is the migration protocol.
 */
export class BackendSentinelMismatchError extends Error {
  readonly code = 'BACKEND_SENTINEL_MISMATCH';

  constructor(message: string) {
    super(message);
    this.name = 'BackendSentinelMismatchError';
  }
}

/**
 * Thrown when the sentinel exists but is unreadable or structurally invalid
 * (e.g. a partial write from a prior crash). It is never treated as "absent"
 * and never silently overwritten.
 */
export class BackendSentinelCorruptError extends Error {
  readonly code = 'BACKEND_SENTINEL_CORRUPT';

  constructor(message: string) {
    super(message);
    this.name = 'BackendSentinelCorruptError';
  }
}

function isStorageBackend(value: unknown): value is StorageBackend {
  return value === 'file' || value === 'sqlite';
}

/**
 * Parse and shape-check raw sentinel bytes. A file that exists but cannot be
 * parsed into a `{backend, schemaVersion}` pair is corrupt, not absent.
 */
function parseSentinel(raw: string, sentinelFile: string): BackendSentinel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackendSentinelCorruptError(`storage sentinel at ${sentinelFile} is not valid JSON`);
  }

  const hasShape =
    typeof parsed === 'object' &&
    parsed !== null &&
    isStorageBackend((parsed as { backend?: unknown }).backend) &&
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion === 'number';

  if (!hasShape) {
    throw new BackendSentinelCorruptError(`storage sentinel at ${sentinelFile} is missing backend/schemaVersion`);
  }

  const record = parsed as BackendSentinel;
  return { backend: record.backend, schemaVersion: record.schemaVersion };
}

/**
 * Read and shape-check the sentinel without creating one.
 *
 * Returns `null` for a fresh data directory (no sentinel yet) so a caller can
 * tell "nothing committed here" apart from "committed to a backend". A sentinel
 * that exists but cannot be parsed is corrupt, never absent: it still throws
 * {@link BackendSentinelCorruptError} rather than reporting `null`, so a partial
 * write from a prior crash can never be silently overwritten.
 *
 * @returns the parsed `{backend, schemaVersion}` record, or `null` when absent.
 * @throws BackendSentinelCorruptError when an existing sentinel is unreadable.
 */
export async function readSentinel(dataDir: string): Promise<BackendSentinel | null> {
  const sentinelFile = path.join(dataDir, SENTINEL_FILENAME);

  let raw: string;
  try {
    raw = await fs.readFile(sentinelFile, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  return parseSentinel(raw, sentinelFile);
}

/**
 * Reconcile this process's chosen backend against the on-disk sentinel,
 * creating it on first run and refusing to start on any disagreement.
 *
 * @returns the reconciled `{backend, schemaVersion}` recorded in the sentinel.
 * @throws BackendSentinelMismatchError when the recorded backend/schema differs.
 * @throws BackendSentinelCorruptError when an existing sentinel cannot be read.
 */
export async function reconcileBackendSentinel(options: {
  dataDir: string;
  backend: StorageBackend;
  schemaVersion?: number;
}): Promise<BackendSentinel> {
  const schemaVersion = options.schemaVersion ?? STORAGE_SCHEMA_VERSION;
  const desired: BackendSentinel = { backend: options.backend, schemaVersion };
  const sentinelFile = path.join(options.dataDir, SENTINEL_FILENAME);

  await fs.mkdir(options.dataDir, { recursive: true });

  // Atomic exclusive create: exactly one process wins the create on first run.
  // A read-then-write-if-absent would race two mismatched processes into both
  // writing, letting the loser silently pass startup.
  try {
    const handle = await fs.open(sentinelFile, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(desired)}\n`, 'utf-8');
    } finally {
      await handle.close();
    }
    return desired;
  } catch (error) {
    const isAlreadyExists = error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST';
    if (!isAlreadyExists) {
      throw error;
    }
  }

  // The sentinel already exists: read it and refuse on any mismatch.
  const raw = await fs.readFile(sentinelFile, 'utf-8');
  const existing = parseSentinel(raw, sentinelFile);

  if (existing.backend !== options.backend) {
    throw new BackendSentinelMismatchError(
      `storage backend mismatch: process requested "${options.backend}" but ` +
        `the data directory is committed to "${existing.backend}" ` +
        `(change it only via the storage migration, not STORAGE_BACKEND)`,
    );
  }

  if (existing.schemaVersion !== schemaVersion) {
    throw new BackendSentinelMismatchError(
      `storage schema mismatch: process expects schemaVersion ${schemaVersion} ` +
        `but the data directory is at ${existing.schemaVersion}`,
    );
  }

  return existing;
}
