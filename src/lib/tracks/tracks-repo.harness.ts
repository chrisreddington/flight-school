/**
 * Shared test harness for the {@link TracksRepo} parity suites (§B.4).
 *
 * The parity matrix is too large for one 500-LOC test file, so it is split
 * across `tracks-repo.enroll.test.ts` and `tracks-repo.steps.test.ts`, both
 * of which import this module. Centralising the harness keeps the two suites
 * honest: they exercise the SAME store construction, the SAME adapter cases,
 * and the SAME recording wrapper, so a divergence between them is a real
 * behavioural difference rather than a harness artefact.
 *
 * Two flavours of store are offered:
 *
 * 1. {@link makeScopedStore} wraps a REAL file or sqlite adapter so the suites
 *    prove the repo's CAS invariants hold identically on both backends — the
 *    headline backend-portability claim.
 * 2. {@link RecordingStore} wraps a real user-scoped store but records every
 *    `put` / `remove` / `removeByParent` and can inject a one-shot conflict on
 *    a chosen write. This drives the deterministic single-thread simulations
 *    (lost-race bridges, bounded-retry exhaustion) that a real race could only
 *    reproduce flakily, and lets a test assert observable call history (e.g.
 *    "the slot was never removed") via plain arrays rather than the banned
 *    `toHaveBeenCalled*` matchers.
 *
 * This is test-only infrastructure: it is imported solely by `*.test.ts`
 * files and never by the backend-portable repo, so it cannot widen the repo's
 * import graph.
 *
 * @module tracks/tracks-repo.harness
 */

import { createRequire } from 'module';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { vi } from 'vitest';

import { createFileDocumentStore } from '../storage/document-store/file-adapter';
import { createSqliteDocumentStore } from '../storage/document-store/sqlite-adapter';
import { DocumentConflictError } from '../storage/document-store/types';
import type {
  ContainerName,
  DocumentEnvelope,
  DocumentStore,
  ListOptions,
  ListResult,
  PutOptions,
} from '../storage/document-store/types';
import { createUserScopedStore } from '../storage/document-store/user-scoped-store';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import type { TracksRepoOptions } from './tracks-repo';

/** The authenticated user every harness store is partitioned for. */
export const USER_ID = 'user-a';

/** A safe-segment track id used across the suites; need not exist in the catalog. */
export const TRACK_A = 'track-alpha';
/** A second distinct safe-segment track id for cross-track isolation cases. */
export const TRACK_B = 'track-beta';

/** Build a fresh temp directory the caller owns and cleans up. */
export async function freshTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'flight-school-tracks-repo-'));
}

/** node:sqlite landed in Node 22.5; the sqlite leg is skipped on older runtimes. */
function nodeSqliteAvailable(): boolean {
  try {
    createRequire(import.meta.url)('node:sqlite');
    return true;
  } catch {
    return false;
  }
}

/** Whether the sqlite adapter leg can run on this runtime. */
export const SQLITE_AVAILABLE = nodeSqliteAvailable();

/** One backend under test: a name plus a factory that builds its raw store. */
export interface AdapterCase {
  name: string;
  make: (dir: string) => Promise<DocumentStore>;
}

/**
 * The file and sqlite adapter cases, driven through `describe.each`. The file
 * case stubs `FLIGHT_SCHOOL_DATA_DIR`; callers must `vi.unstubAllEnvs()` in
 * `afterEach`.
 */
export const adapterCases: AdapterCase[] = [
  {
    name: 'file',
    make: async (dir) => {
      vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', dir);
      return createFileDocumentStore();
    },
  },
  {
    name: 'sqlite',
    make: async (dir) => createSqliteDocumentStore({ dbPath: path.join(dir, 'docstore.sqlite') }),
  },
];

/**
 * Wrap a raw store as a user-scoped store for {@link USER_ID}, with the
 * deletion tombstone always clear (the repo's concern is CAS, not deletion).
 */
export function makeScopedStore(raw: DocumentStore, userId: string = USER_ID): UserScopedStore {
  return createUserScopedStore(userId, raw, { isUserDeleted: async () => false });
}

/**
 * Deterministic clock/id seams for {@link TracksRepoOptions}.
 *
 * Timestamps advance by one second per call from a fixed base so ordering is
 * observable and stable; enrollment ids are a simple incrementing sequence so
 * a test can name the candidate a given `enroll()` call will create.
 *
 * @param idPrefix - Distinguishes the id sequence when two repos share a store
 *   in a concurrency simulation (e.g. `'c1'` vs `'c2'`).
 */
export function deterministicOptions(idPrefix = 'enr'): Required<Pick<TracksRepoOptions, 'now' | 'newEnrollmentId'>> {
  let tick = 0;
  let seq = 0;
  const base = Date.parse('2026-06-01T00:00:00.000Z');
  return {
    now: () => new Date(base + tick++ * 1000).toISOString(),
    newEnrollmentId: () => `${idPrefix}-${++seq}`,
  };
}

/** A recorded `put` call, captured before the inner store is touched. */
export interface PutCall {
  container: ContainerName;
  id: string;
  opts: PutOptions | undefined;
}

/** A predicate selecting which `put` a one-shot conflict injector fires on. */
export type PutMatcher = (call: PutCall) => boolean;

/** A primed one-shot conflict: fires on the first matching put, then disarms. */
interface ConflictInjector {
  matches: PutMatcher;
  before?: () => Promise<void>;
}

/**
 * A {@link UserScopedStore} decorator that records writes and can inject a
 * single CAS conflict on a chosen `put`.
 *
 * Reads pass straight through. Writes are recorded BEFORE delegating, so the
 * call history reflects intent even when a write later throws. When a primed
 * injector matches a `put`, the decorator runs its optional `before` hook
 * (used to plant a competing winner directly into the inner store, simulating
 * the racing writer) and then throws {@link DocumentConflictError} WITHOUT
 * delegating — exactly what a lost CAS race looks like to the repo.
 */
export class RecordingStore implements UserScopedStore {
  readonly putCalls: PutCall[] = [];
  readonly removeCalls: Array<{ container: ContainerName; id: string }> = [];
  readonly removeByParentCalls: Array<{ container: ContainerName; parentId: string }> = [];

  readonly #inner: UserScopedStore;
  #injectors: ConflictInjector[] = [];

  constructor(inner: UserScopedStore) {
    this.#inner = inner;
  }

  /**
   * Prime a one-shot conflict on the first `put` matching `matches`. The
   * optional `before` hook runs just before the conflict throws, so a test can
   * mutate the inner store to model the writer that won the race.
   */
  failNextPutWhere(matches: PutMatcher, before?: () => Promise<void>): void {
    this.#injectors.push({ matches, before });
  }

  /** Count recorded puts to `container` whose id satisfies `idMatches`. */
  putCount(container: ContainerName, idMatches: (id: string) => boolean): number {
    return this.putCalls.filter((call) => call.container === container && idMatches(call.id)).length;
  }

  get<T>(container: ContainerName, id: string): Promise<T | null> {
    return this.#inner.get<T>(container, id);
  }

  getEnvelope<T>(container: ContainerName, id: string): Promise<DocumentEnvelope<T> | null> {
    return this.#inner.getEnvelope<T>(container, id);
  }

  async put<T>(container: ContainerName, id: string, body: T, opts?: PutOptions): Promise<DocumentEnvelope<T>> {
    const call: PutCall = { container, id, opts };
    this.putCalls.push(call);

    const injectorIndex = this.#injectors.findIndex((injector) => injector.matches(call));
    if (injectorIndex !== -1) {
      const [injector] = this.#injectors.splice(injectorIndex, 1);
      if (injector.before) await injector.before();
      throw new DocumentConflictError(`injected conflict on put ${container}/${id}`);
    }

    return this.#inner.put<T>(container, id, body, opts);
  }

  async remove(container: ContainerName, id: string): Promise<void> {
    this.removeCalls.push({ container, id });
    await this.#inner.remove(container, id);
  }

  list<T>(container: ContainerName, opts?: ListOptions): Promise<ListResult<T>> {
    return this.#inner.list<T>(container, opts);
  }

  async removeByParent(container: ContainerName, parentId: string): Promise<void> {
    this.removeByParentCalls.push({ container, parentId });
    await this.#inner.removeByParent(container, parentId);
  }

  deletePartition(container: ContainerName): Promise<void> {
    return this.#inner.deletePartition(container);
  }
}
