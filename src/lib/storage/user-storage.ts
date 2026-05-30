/**
 * Per-user server-side storage helpers.
 *
 * These functions are the canonical way for Server Components, Server Actions,
 * and the storage-route factory to read/write a user's JSON storage. They
 * resolve the authenticated user via {@link requireUserContext}, validate the
 * user id against {@link userScopedFilename}, and ensure the per-user dir
 * exists before delegating to storage.
 *
 * Storage backend (S1): the domain singletons (skills, habits, focus, profile,
 * challenge queue) live in the envelope
 * {@link import('./document-store/types').DocumentStore}. Their reads/writes
 * route through the read-through-migrating compat core in
 * {@link import('./document-store/user-storage-core')}, which serves a healthy
 * legacy file once and self-heals everything else into the store. Any filename
 * NOT in that mapping (threads, job blobs, evaluation) still uses the legacy
 * file primitives {@link readStorage}/{@link writeStorage}/{@link deleteStorage}
 * unchanged.
 *
 * Multi-tenant invariant: every call partitions storage by `userId`. There is
 * no shared cross-user view of any data file or envelope.
 */

import { requireUserContext } from '@/lib/auth/context';
import { logger } from '@/lib/logger';
import { deleteStorage, ensureDir, readStorage, writeStorage } from './utils';
import { userScopedFilename } from './user-scope';
import { buildCompatDeps } from './document-store/compat-deps';
import {
  readMappedDoc,
  removeMappedDoc,
  resolveContainerMapping,
  writeMappedDoc,
} from './document-store/user-storage-core';

const log = logger.withTag('User Storage');

/**
 * Validation gate that mirrors {@link readStorage}/{@link writeStorage}'s
 * own signature so callers can pass the same schema guard everywhere.
 */
export type SchemaGuard<T> = (data: unknown) => data is T;

/**
 * Build the scoped legacy-file path for `userId`/`filename` and ensures the
 * per-user directory exists. Used only by the UNMAPPED (legacy-file) read/write
 * path; mapped singletons resolve their deps via {@link buildCompatDeps}.
 */
async function ensureUserScopedPath(userId: string, filename: string): Promise<string> {
  const path = userScopedFilename(userId, filename);
  await ensureDir(`users/${userId}`, { mode: 0o700 });
  return path;
}

/**
 * Authenticates the caller and validates that their userId yields a safe
 * scoped path for `filename`, WITHOUT creating any directory. The storage-route
 * factory uses this to authenticate + validate once with no side effects, so an
 * invalid POST body never leaves a stray `users/{userId}` directory behind. The
 * `*ForUser` writers create the directory only when they actually persist data.
 *
 * @throws when the caller isn't authenticated or the userId isn't path-safe.
 */
export async function resolveScopedUserId(filename: string): Promise<string> {
  const { userId } = await requireUserContext();
  userScopedFilename(userId, filename);
  return userId;
}

/**
 * Reads `filename` for an already-resolved `userId`, returning `defaultSchema`
 * when no valid source exists. Migrated singletons read through the envelope
 * store (serving a healthy legacy file once); unmapped files read the legacy
 * file. Callers that hold a userId (e.g. the storage-route factory) use this to
 * avoid re-authenticating; {@link readUserStorage} wraps it with auth.
 *
 * @internal `userId` MUST come from a trusted auth context (e.g.
 * {@link requireUserContext}) — never from a route param or request body. This
 * helper validates path safety, NOT identity authorization, so passing an
 * attacker-controlled userId would read another tenant's data.
 */
export async function readUserStorageForUser<T>(
  userId: string,
  filename: string,
  defaultSchema: T,
  guard: SchemaGuard<T>,
): Promise<T> {
  const mapping = resolveContainerMapping(filename);
  if (mapping === null) {
    const path = await ensureUserScopedPath(userId, filename);
    return readStorage<T>(path, defaultSchema, guard);
  }
  const deps = await buildCompatDeps(userId);
  return readMappedDoc(deps, mapping, filename, defaultSchema, guard);
}

/**
 * Reads `filename` for the authenticated user, returning `defaultSchema` when
 * no valid source exists. Migrated singletons read through the envelope store
 * (serving a healthy legacy file once); unmapped files read the legacy file.
 *
 * @remarks
 * Authentication errors propagate — callers in Server Components should let
 * them bubble so the page renders the auth-required UI.
 */
export async function readUserStorage<T>(filename: string, defaultSchema: T, guard: SchemaGuard<T>): Promise<T> {
  const { userId } = await requireUserContext();
  return readUserStorageForUser(userId, filename, defaultSchema, guard);
}

/**
 * Writes `data` to `filename` for an already-resolved `userId` after validating
 * it with `guard`. Validation runs BEFORE any side effect (no directory is
 * created and no backend store is initialised) so an invalid payload never
 * mutates on-disk state. Throws if validation fails. Callers that hold a userId
 * use this to avoid re-authenticating; {@link writeUserStorage} wraps it with auth.
 *
 * @internal `userId` MUST come from a trusted auth context (e.g.
 * {@link requireUserContext}) — never from a route param or request body. This
 * helper validates path safety, NOT identity authorization, so passing an
 * attacker-controlled userId would overwrite another tenant's data.
 */
export async function writeUserStorageForUser<T>(
  userId: string,
  filename: string,
  data: T,
  guard: SchemaGuard<T>,
): Promise<void> {
  if (!guard(data)) {
    log.error('Refusing to write invalid storage payload', { filename });
    throw new Error(`Invalid storage schema for ${filename}`);
  }
  const mapping = resolveContainerMapping(filename);
  if (mapping === null) {
    const path = await ensureUserScopedPath(userId, filename);
    await writeStorage(path, data);
    return;
  }
  const deps = await buildCompatDeps(userId);
  await writeMappedDoc(deps, mapping, filename, data, guard);
}

/**
 * Writes `data` to `filename` for the authenticated user after validating
 * it with `guard`. Throws if validation fails so Server Actions surface the
 * error rather than silently corrupting the data.
 */
export async function writeUserStorage<T>(filename: string, data: T, guard: SchemaGuard<T>): Promise<void> {
  const { userId } = await requireUserContext();
  await writeUserStorageForUser(userId, filename, data, guard);
}

/**
 * Deletes `filename` for an already-resolved `userId`. Idempotent. Callers that
 * hold a userId use this to avoid re-authenticating; {@link deleteUserStorage}
 * wraps it with auth.
 *
 * @internal `userId` MUST come from a trusted auth context (e.g.
 * {@link requireUserContext}) — never from a route param or request body. This
 * helper validates path safety, NOT identity authorization, so passing an
 * attacker-controlled userId would delete another tenant's data.
 */
export async function deleteUserStorageForUser(userId: string, filename: string): Promise<void> {
  const mapping = resolveContainerMapping(filename);
  if (mapping === null) {
    const path = await ensureUserScopedPath(userId, filename);
    await deleteStorage(path);
    return;
  }
  const deps = await buildCompatDeps(userId);
  await removeMappedDoc(deps, mapping, filename);
}

/**
 * Deletes `filename` for the authenticated user. Idempotent. Migrated
 * singletons clear both the envelope and any shadowed legacy file; unmapped
 * files delete the legacy file only.
 */
export async function deleteUserStorage(filename: string): Promise<void> {
  const { userId } = await requireUserContext();
  await deleteUserStorageForUser(userId, filename);
}
