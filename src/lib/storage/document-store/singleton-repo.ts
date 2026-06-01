/**
 * Typed per-user singleton accessor over the envelope {@link DocumentStore}.
 *
 * A "singleton" is a document a user has exactly one of — their skills profile,
 * habit collection, focus history, profile cache, or challenge queue. Each was
 * historically a single `users/{userId}/{filename}.json` file; S1 moves them
 * into the envelope store while preserving the legacy read-through (see
 * {@link import('./user-storage-core')}).
 *
 * {@link createSingletonRepo} turns the loose `(filename, default, guard)`
 * triple that the storage routes and server accessors each re-declared into one
 * typed object that owns the filename, default, schema guard, and optional
 * write-time stamp. Domain modules build a repo once and both their RSC
 * accessors and their storage route consume the SAME guard/default/filename, so
 * the three copies can no longer drift.
 *
 * This module is SERVER-SIDE: it resolves real {@link CompatDeps} via
 * {@link buildCompatDeps}, which imports the `server-only` envelope backend.
 * Most repos are web/server accessors, but the evaluations and threads
 * singletons are also **worker-reached** — safe because the worker esbuild
 * shims `server-only` and this chain imports no `next/*`
 * (`scripts/check-worker-next-free.mjs` enforces it).
 *
 * @module storage/document-store/singleton-repo
 */

import { buildCompatDeps } from './compat-deps';
import {
  readMappedDoc,
  removeMappedDoc,
  resolveContainerMapping,
  writeMappedDoc,
  type SchemaGuard,
} from './user-storage-core';

/**
 * Typed accessor for a single per-user document. Every method takes an
 * already-trusted `userId` (resolved from a server auth context by the caller)
 * and never re-authenticates.
 *
 * @template T - The validated document body type.
 */
export interface SingletonRepo<T> {
  /** Legacy filename this singleton maps onto (e.g. `'skills-profile.json'`). */
  readonly filename: string;
  /** Value returned when no valid stored document exists. */
  readonly defaultValue: T;
  /** Schema guard the routes and accessors share for this document. */
  readonly guard: SchemaGuard<T>;
  /** Read the document, returning {@link defaultValue} when absent/corrupt. */
  read(userId: string): Promise<T>;
  /**
   * Validate, optionally stamp, and persist `body`. Returns the value actually
   * written (stamped when a `stamp` is configured) so callers can reuse it
   * without re-reading.
   */
  write(userId: string, body: T): Promise<T>;
  /** Idempotently delete the document (envelope + any shadowed legacy file). */
  remove(userId: string): Promise<void>;
}

/**
 * Build a {@link SingletonRepo} for a mapped singleton filename.
 *
 * @param config.filename - The legacy filename; MUST be present in the compat
 *   core's container mapping (skills/habits/focus/profile/challenge-queue).
 * @param config.defaultValue - Returned by {@link SingletonRepo.read} when no
 *   valid document exists.
 * @param config.guard - Schema guard applied on read (heal on failure) and
 *   write (reject on failure).
 * @param config.stamp - Optional pre-write transform (e.g. set `lastUpdated`).
 *   When present, {@link SingletonRepo.write} stamps the body BEFORE validating
 *   and persisting, and returns the stamped value.
 * @throws {Error} at construction time when `filename` is not a mapped
 *   singleton — a programming error surfaced at module load, not per request.
 */
export function createSingletonRepo<T>(config: {
  filename: string;
  defaultValue: T;
  guard: SchemaGuard<T>;
  stamp?: (body: T) => T;
}): SingletonRepo<T> {
  const { filename, defaultValue, guard, stamp } = config;
  const mapping = resolveContainerMapping(filename);
  if (mapping === null) {
    throw new Error(`createSingletonRepo: '${filename}' is not a mapped singleton document`);
  }

  return {
    filename,
    defaultValue,
    guard,
    async read(userId: string): Promise<T> {
      const deps = await buildCompatDeps(userId);
      return readMappedDoc(deps, mapping, filename, defaultValue, guard);
    },
    async write(userId: string, body: T): Promise<T> {
      const stamped = stamp ? stamp(body) : body;
      const deps = await buildCompatDeps(userId);
      await writeMappedDoc(deps, mapping, filename, stamped, guard);
      return stamped;
    },
    async remove(userId: string): Promise<void> {
      const deps = await buildCompatDeps(userId);
      await removeMappedDoc(deps, mapping, filename);
    },
  };
}
