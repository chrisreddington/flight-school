/**
 * Best-effort advisory lock for the storage importer.
 *
 * @remarks
 * This is a single-operator UX guard — it stops a second `npm run
 * storage:migrate` invocation from racing the first — not a cross-process
 * lease (that is an S2 concern). The lock file lives deliberately OUTSIDE the
 * data root so it never lands in a partition the importer itself walks. A live
 * lock is refused; a stale or malformed lock is reported (never auto-claimed)
 * so the operator clears it by hand, mirroring git's `index.lock`.
 *
 * @module storage/migrate-lock
 */

import { promises as fs } from 'fs';
import path from 'path';

import { getStorageRoot } from '@/lib/storage/utils';

/** How long a lock is considered live before it is reported as stale. */
const LOCK_TTL_MS = 10 * 60 * 1000;

/** Thrown when another live migration already holds the advisory lock. */
export class StorageMigrationLockError extends Error {
  constructor(public readonly heldBy?: string) {
    super(`Another migration holds the advisory lock${heldBy ? ` (owner ${heldBy})` : ''}.`);
    this.name = 'StorageMigrationLockError';
  }
}

/**
 * Thrown when the lock file exists but its lease has expired or its contents
 * are unparseable. Auto-takeover is deliberately NOT attempted: a
 * `rm`-then-`wx` sequence still races a second operator across processes (the
 * classic delete-the-live-lock TOCTOU), so a crashed run leaves a lock that an
 * operator must remove by hand. Subclasses {@link StorageMigrationLockError} so
 * the CLI's exit-2 branch still catches it.
 */
export class StaleStorageMigrationLockError extends StorageMigrationLockError {
  constructor(
    public readonly lockPath: string,
    heldBy?: string,
  ) {
    super(heldBy);
    this.name = 'StaleStorageMigrationLockError';
    this.message =
      `A stale migration lock remains at ${lockPath}` +
      `${heldBy ? ` (owner ${heldBy})` : ''}. A previous run likely crashed; ` +
      'remove the file and re-run the migration.';
  }
}

/** Opaque handle returned by {@link acquireLock} and passed to {@link releaseLock}. */
export interface LockHandle {
  filePath: string;
  ownerId: string;
}

interface LockPayload {
  ownerId?: string;
  expiresAt?: string;
}

/** Path of the advisory lock file, deliberately OUTSIDE the data root. */
function lockFilePath(): string {
  return path.join(getStorageRoot(), '..', '.storage-migration-lock');
}

/** Reads the lock file, tolerating absence and malformed contents. */
async function readLockPayload(filePath: string): Promise<LockPayload | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

/**
 * Acquires the best-effort advisory lock. A live lock from another owner is
 * refused; a stale or malformed lock is reported (never auto-claimed) so the
 * operator removes it by hand. Single-operator UX guard, not a cross-process
 * lease (that is an S2 concern).
 *
 * @throws StorageMigrationLockError When a live (unexpired) lock is held.
 * @throws StaleStorageMigrationLockError When a stale/malformed lock remains.
 */
export async function acquireLock(ownerId: string, now: () => number): Promise<LockHandle> {
  const filePath = lockFilePath();
  const payload = JSON.stringify({
    ownerId,
    lockedAt: new Date(now()).toISOString(),
    expiresAt: new Date(now() + LOCK_TTL_MS).toISOString(),
  });
  try {
    await fs.writeFile(filePath, payload, { flag: 'wx' });
    return { filePath, ownerId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    const existing = await readLockPayload(filePath);
    const expiresAt = existing?.expiresAt ? Date.parse(existing.expiresAt) : Number.NaN;
    const isLive = Number.isFinite(expiresAt) && expiresAt >= now();
    if (isLive) {
      throw new StorageMigrationLockError(existing?.ownerId);
    }
    // A stale or malformed (NaN-`expiresAt`) lock is reported, never claimed:
    // `rm`-then-`wx` would reintroduce the cross-process delete-the-live-lock
    // TOCTOU. The operator clears the file by hand and re-runs.
    throw new StaleStorageMigrationLockError(filePath, existing?.ownerId);
  }
}

/** Releases the advisory lock, but only if this run still owns it. */
export async function releaseLock(handle: LockHandle): Promise<void> {
  const existing = await readLockPayload(handle.filePath);
  if (existing?.ownerId === handle.ownerId) {
    await fs.rm(handle.filePath, { force: true });
  }
}
