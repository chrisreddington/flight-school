/**
 * Best-effort advisory lock for the storage importer.
 *
 * @remarks
 * This is a single-operator UX guard — it stops a second `npm run
 * storage:migrate` invocation from racing the first — not a cross-process
 * lease (that is an S2 concern). The lock file lives deliberately OUTSIDE the
 * data root so it never lands in a partition the importer itself walks, and a
 * lease whose `expiresAt` has passed may be taken over.
 *
 * @module storage/migrate-lock
 */

import { promises as fs } from 'fs';
import path from 'path';

import { getStorageRoot } from '@/lib/storage/utils';

/** How long an advisory lock is honoured before a peer may take it over. */
const LOCK_TTL_MS = 10 * 60 * 1000;

/** Thrown when another live migration already holds the advisory lock. */
export class StorageMigrationLockError extends Error {
  constructor(public readonly heldBy?: string) {
    super(`Another migration holds the advisory lock${heldBy ? ` (owner ${heldBy})` : ''}.`);
    this.name = 'StorageMigrationLockError';
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
 * Acquires the best-effort advisory lock, taking over a lock whose lease has
 * already expired. This is a single-operator UX guard, not a cross-process
 * lease (that is an S2 concern).
 *
 * @throws StorageMigrationLockError When a live (unexpired) lock is held.
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
    if (!Number.isFinite(expiresAt) || expiresAt >= now()) {
      throw new StorageMigrationLockError(existing?.ownerId);
    }
    await fs.rm(filePath, { force: true });
    await fs.writeFile(filePath, payload, { flag: 'wx' });
    return { filePath, ownerId };
  }
}

/** Releases the advisory lock, but only if this run still owns it. */
export async function releaseLock(handle: LockHandle): Promise<void> {
  const existing = await readLockPayload(handle.filePath);
  if (existing?.ownerId === handle.ownerId) {
    await fs.rm(handle.filePath, { force: true });
  }
}
