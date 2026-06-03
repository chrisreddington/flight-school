/**
 * Read-through-migrating compat core for the legacy per-user JSON storage API.
 *
 * The legacy {@link import('../user-storage').readUserStorage} /
 * {@link import('../user-storage').writeUserStorage} surface reads and writes a
 * single JSON file per user (`users/{userId}/{filename}`). S1 moves the
 * domain singletons (skills, habits, focus, profile, challenge queue) into the
 * envelope {@link DocumentStore} without breaking that public surface. This
 * module holds the pure, Next-free core of that migration so it can be parity-
 * tested against BOTH the file and sqlite adapters with an injected store + an
 * injected legacy-IO seam.
 *
 * The core is deliberately split from `../user-storage` (which resolves the
 * authenticated user) so the tests never have to stub auth or module-level
 * env: they construct a real {@link UserScopedStore} over a temp dir and a
 * temp legacy seam, then drive the six §A.6 behaviours directly.
 *
 * Read-through-migrating semantics for a MAPPED filename:
 * - Envelope present + valid → return it (the store is now the source of truth).
 * - Envelope present + corrupt → overwrite with the default, return the default.
 * - Envelope absent + legacy present + valid → return the legacy body WITHOUT
 *   writing it back. The standalone migrator ({@link import('../migrate')}) is
 *   the only writer that promotes a legacy file into an envelope, so a healthy
 *   legacy file is left untouched here.
 * - Envelope absent + legacy missing/empty/corrupt → self-heal by writing the
 *   default as an ENVELOPE (never back to the legacy file), return the default.
 *
 * @module storage/document-store/user-storage-core
 */

import { logger } from '@/lib/logger';
import { tryParseJson } from '@/lib/storage/json';
import type { ContainerName, PutOptions } from './types';
import { DocumentConflictError, SINGLETON_DOCUMENT_ID } from './types';
import { UserDeletedError, type UserScopedStore } from './user-scoped-store';

const log = logger.withTag('User Storage Compat');

/**
 * Validation gate. Mirrors the legacy `SchemaGuard<T>` so callers pass the
 * same schema predicate to the compat core that they passed to the old
 * file-backed helpers.
 */
export type SchemaGuard<T> = (candidate: unknown) => candidate is T;

/**
 * Read/delete seam over the legacy `users/{userId}/{filename}` file. The compat
 * core consults it ONLY when no envelope exists yet (read) or to clear a
 * shadowed legacy file (delete). It deliberately exposes no write: the core
 * never writes back to the legacy file — self-heal and promotion both target the
 * envelope store.
 */
export interface LegacyDocumentIO {
  /**
   * Raw read of the legacy file with NO self-heal write-back. Returns the file
   * contents verbatim, or `null` when the file is absent. Parsing and schema
   * validation happen in the core so a corrupt legacy file degrades to the
   * default exactly like a missing one.
   */
  readRaw(filename: string): Promise<string | null>;
  /** Idempotent delete of the legacy file (absent file is a no-op). */
  remove(filename: string): Promise<void>;
}

/** The envelope coordinates a legacy filename maps onto. */
export interface ContainerMapping {
  container: ContainerName;
  id: string;
}

/**
 * Legacy filename → envelope `(container, id)` map. Every entry is a per-user
 * singleton, so the id is always {@link SINGLETON_DOCUMENT_ID}. A filename
 * absent from this map is NOT migrated and falls through to the unchanged
 * legacy file path in {@link import('../user-storage')}.
 *
 * @remarks
 * `challenge-queue.json` is written from two callers — the storage route at
 * `src/app/api/challenges/queue/route.ts` and the server action at
 * `src/app/challenge/actions.ts` — with a structurally identical
 * `{ challenges, lastUpdated }` body. Both resolve to the same envelope here,
 * so the two callers share one document exactly as they shared one file before.
 *
 * `evaluations` has no `.json` extension — it matches the legacy flat path
 * `users/{userId}/evaluations` the evaluation store has always used. It is
 * **worker-reached** (the evaluation executor writes progress), unlike the
 * other web-only singletons here.
 */
const FILENAME_TO_CONTAINER: ReadonlyMap<string, ContainerName> = new Map([
  ['skills-profile.json', 'skills'],
  ['habits.json', 'habits'],
  ['focus-storage.json', 'focus'],
  ['profile-cache.json', 'profile'],
  ['challenge-queue.json', 'challenge-queue'],
  ['evaluations', 'evaluations'],
  ['threads.json', 'threads'],
]);

/**
 * Resolve the envelope coordinates for a legacy `filename`, or `null` when the
 * filename is not migrated (callers fall back to the legacy file path).
 */
export function resolveContainerMapping(filename: string): ContainerMapping | null {
  const container = FILENAME_TO_CONTAINER.get(filename);
  if (container === undefined) {
    return null;
  }
  return { container, id: SINGLETON_DOCUMENT_ID };
}

/**
 * The legacy filenames that map onto per-user singleton envelopes, in insertion
 * order. The storage migrator iterates this list to discover which singleton
 * files to import; every entry resolves through {@link resolveContainerMapping}.
 */
export const MIGRATABLE_SINGLETON_FILENAMES: readonly string[] = [...FILENAME_TO_CONTAINER.keys()];

/** Dependencies the compat core operates against. */
export interface CompatDeps {
  store: UserScopedStore;
  legacy: LegacyDocumentIO;
}

/**
 * Reject a serialization that the legacy {@link import('../utils').writeStorage}
 * would have refused. The legacy writer threw on an empty object/array to avoid
 * clobbering a populated file with a no-op payload; the envelope store has no
 * such guard, so the compat core replicates it for parity.
 */
function assertNonEmptySerialization<T>(payload: T, filename: string): void {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized.length === 0 || serialized === '{}' || serialized === '[]') {
    throw new Error(`Attempted to write empty data to ${filename}`);
  }
}

/**
 * Self-heal a mapped document to `defaultSchema` under CAS, so a concurrent
 * writer that lands a value between the read and this heal is never clobbered
 * with the default.
 *
 * @param expectedEtag - The etag the read observed (corrupt-envelope branch),
 *   or `null` when the envelope was absent (create-if-absent branch).
 * @returns the default; or, when a concurrent writer won the CAS race, that
 *   winner's body if it passes `guard`, else the default in memory.
 * @remarks
 * On {@link UserDeletedError} the default is returned WITHOUT persisting: a read
 * must never resurrect a tombstoned user.
 */
async function healWithDefault<T>(
  deps: CompatDeps,
  mapping: ContainerMapping,
  defaultSchema: T,
  guard: SchemaGuard<T>,
  expectedEtag: string | null,
): Promise<T> {
  const casOption: PutOptions = expectedEtag === null ? { ifNoneMatch: '*' } : { ifMatch: expectedEtag };
  try {
    await deps.store.put(mapping.container, mapping.id, defaultSchema, casOption);
    return defaultSchema;
  } catch (error) {
    if (error instanceof UserDeletedError) {
      return defaultSchema;
    }
    if (!(error instanceof DocumentConflictError)) {
      throw error;
    }
    const winner = await deps.store.getEnvelope<T>(mapping.container, mapping.id);
    if (winner !== null && guard(winner.body)) {
      return winner.body;
    }
    return defaultSchema;
  }
}

/**
 * Read a mapped document with read-through-migrating semantics.
 *
 * @returns the validated body, or `defaultSchema` when no valid source exists.
 *   When the default is returned because the envelope was absent/corrupt, it is
 *   self-healed into the ENVELOPE store (never the legacy file) under CAS. A
 *   healthy legacy file is returned as-is and left for the migrator to promote.
 */
export async function readMappedDoc<T>(
  deps: CompatDeps,
  mapping: ContainerMapping,
  filename: string,
  defaultSchema: T,
  guard: SchemaGuard<T>,
): Promise<T> {
  const envelope = await deps.store.getEnvelope<T>(mapping.container, mapping.id);
  if (envelope !== null) {
    if (guard(envelope.body)) {
      return envelope.body;
    }
    log.warn('Envelope failed schema guard; healing with default', { filename });
    return healWithDefault(deps, mapping, defaultSchema, guard, envelope.etag);
  }

  const raw = await deps.legacy.readRaw(filename);
  if (raw !== null) {
    const parsed = tryParseJson(raw);
    if (parsed !== undefined && guard(parsed)) {
      // Healthy legacy file: hand it back without writing an envelope. The
      // migrator is the sole promoter of legacy files into the store.
      return parsed;
    }
  }

  return healWithDefault(deps, mapping, defaultSchema, guard, null);
}

/**
 * Write a mapped document into the envelope store after validating it.
 *
 * Throws when `guard` rejects the payload or when it would serialize to an
 * empty object/array — both legacy-`writeStorage` behaviours preserved so a
 * migrated write fails identically to the file-backed one.
 */
export async function writeMappedDoc<T>(
  deps: CompatDeps,
  mapping: ContainerMapping,
  filename: string,
  payload: T,
  guard: SchemaGuard<T>,
): Promise<void> {
  if (!guard(payload)) {
    log.error('Refusing to write invalid storage payload', { filename });
    throw new Error(`Invalid storage schema for ${filename}`);
  }
  assertNonEmptySerialization(payload, filename);
  await deps.store.put(mapping.container, mapping.id, payload);
}

/**
 * Delete a mapped document. Idempotent: clears BOTH the envelope and any
 * shadowed legacy file so a returning reader cannot resurrect stale legacy
 * content after the envelope is gone.
 */
export async function removeMappedDoc(deps: CompatDeps, mapping: ContainerMapping, filename: string): Promise<void> {
  await deps.store.remove(mapping.container, mapping.id);
  await deps.legacy.remove(filename);
}
