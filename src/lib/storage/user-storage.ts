/**
 * Per-user server-side storage helpers.
 *
 * These functions are the canonical way for Server Components, Server Actions,
 * and the storage-route factory to read/write a user's JSON storage. They
 * resolve the authenticated user via {@link requireUserContext}, validate the
 * user id against {@link userScopedFilename}, and ensure the per-user dir
 * exists before delegating to the low-level {@link readStorage}/{@link
 * writeStorage}/{@link deleteStorage} primitives.
 *
 * Multi-tenant invariant: every call partitions the underlying file path by
 * `userId`. There is no shared cross-user view of any data file.
 */

import { requireUserContext } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { ensureDir, readStorage, writeStorage, deleteStorage } from './utils';
import { userScopedFilename } from './user-scope';

const log = logger.withTag('User Storage');

/**
 * Validation gate that mirrors {@link readStorage}/{@link writeStorage}'s
 * own signature so callers can pass the same schema guard everywhere.
 */
export type SchemaGuard<T> = (data: unknown) => data is T;

/**
 * Resolves the authenticated user, builds their scoped path for `filename`,
 * and ensures the directory exists. Returns the resolved path + userId, or
 * throws if the caller isn't authenticated / the userId isn't safe.
 */
export async function resolveUserScopedPath(filename: string): Promise<{ path: string; userId: string }> {
  const { userId } = await requireUserContext();
  const path = userScopedFilename(userId, filename);
  await ensureDir(`users/${userId}`, { mode: 0o700 });
  return { path, userId };
}

/**
 * Reads `filename` for the authenticated user, returning `defaultSchema` when
 * the file is missing or fails {@link guard} validation.
 *
 * @remarks
 * Authentication errors propagate — callers in Server Components should let
 * them bubble so the page renders the auth-required UI.
 */
export async function readUserStorage<T>(
  filename: string,
  defaultSchema: T,
  guard: SchemaGuard<T>,
): Promise<T> {
  const { path } = await resolveUserScopedPath(filename);
  return readStorage<T>(path, defaultSchema, guard);
}

/**
 * Writes `data` to `filename` for the authenticated user after validating
 * it with `guard`. Throws if validation fails so Server Actions surface the
 * error rather than silently corrupting the file.
 */
export async function writeUserStorage<T>(
  filename: string,
  data: T,
  guard: SchemaGuard<T>,
): Promise<void> {
  if (!guard(data)) {
    log.error('Refusing to write invalid storage payload', { filename });
    throw new Error(`Invalid storage schema for ${filename}`);
  }
  const { path } = await resolveUserScopedPath(filename);
  await writeStorage(path, data);
}

/**
 * Deletes `filename` for the authenticated user. Idempotent: missing files
 * are not an error.
 */
export async function deleteUserStorage(filename: string): Promise<void> {
  const { path } = await resolveUserScopedPath(filename);
  await deleteStorage(path);
}
