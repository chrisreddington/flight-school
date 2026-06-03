/**
 * Tests for the standalone legacy → docstore importer
 * ({@link runStorageMigration}).
 *
 * The data dir is stubbed to an isolated, NESTED temp directory **before**
 * `migrate.ts` (and the `../utils` primitives it wraps, which capture the dir
 * at module load) are dynamically imported. The nesting matters: the advisory
 * lock lives at `getStorageRoot()/../.storage-migration-lock`, so a nested data
 * root keeps each suite's lock file inside its own temp tree.
 *
 * Runs drive a real file-backed {@link DocumentStore} (injected) while labelling
 * the backend `sqlite`, so the file-backend refusal guard never trips except in
 * the tests that exercise it directly.
 *
 * @module storage/migrate.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { canonicalizeBody } from './document-store/canonical';
import type { DocumentStore } from './document-store/types';

const TEST_ROOT = path.join(os.tmpdir(), `flight-school-migrate-${Date.now()}-${process.pid}`);
const TEST_DATA_DIR = path.join(TEST_ROOT, 'data');
const LOCK_PATH = path.join(TEST_ROOT, '.storage-migration-lock');

let runStorageMigration: typeof import('./migrate').runStorageMigration;
let StorageMigrationRefusedError: typeof import('./migrate').StorageMigrationRefusedError;
let StorageMigrationUserError: typeof import('./migrate').StorageMigrationUserError;
let DocumentConflictError: typeof import('./document-store/types').DocumentConflictError;
let releaseLock: typeof import('./migrate-lock').releaseLock;
let createFileDocumentStore: () => DocumentStore;
let readLegacyWorkspaceTree: typeof import('../workspace/legacy-tree').readLegacyWorkspaceTree;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_DATA_DIR);
  ({ runStorageMigration, StorageMigrationRefusedError, StorageMigrationUserError } = await import('./migrate'));
  ({ DocumentConflictError } = await import('./document-store/types'));
  ({ releaseLock } = await import('./migrate-lock'));
  ({ createFileDocumentStore } = await import('./document-store/file-adapter'));
  ({ readLegacyWorkspaceTree } = await import('../workspace/legacy-tree'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
  await fs.mkdir(TEST_DATA_DIR, { recursive: true });
});

/** Writes a legacy file under `users/{userId}/{relativePath}`. */
async function seedLegacyFile(userId: string, relativePath: string, body: unknown): Promise<void> {
  const filePath = path.join(TEST_DATA_DIR, 'users', userId, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  await fs.writeFile(filePath, serialized, 'utf8');
}

/** Builds a structurally valid legacy workspace metadata sidecar fixture. */
function workspaceMetadata(challengeId: string, fileNames: string[]): Record<string, unknown> {
  return {
    version: 1,
    challengeId,
    activeFileId: fileNames.length > 0 ? `file-${fileNames[0]}` : 'none',
    files: fileNames.map((name) => ({
      id: `file-${name}`,
      name,
      language: 'typescript',
      createdAt: 1,
      updatedAt: 2,
    })),
    createdAt: 1,
    updatedAt: 2,
  };
}

/** A store whose `put` throws a non-conflict error for one target id. */
function failingPutStore(base: DocumentStore, failId: string): DocumentStore {
  return {
    get: (container, partitionKey, id) => base.get(container, partitionKey, id),
    getEnvelope: (container, partitionKey, id) => base.getEnvelope(container, partitionKey, id),
    list: (container, partitionKey, opts) => base.list(container, partitionKey, opts),
    remove: (container, partitionKey, id) => base.remove(container, partitionKey, id),
    removeByParent: (container, partitionKey, parentId) => base.removeByParent(container, partitionKey, parentId),
    deletePartition: (container, partitionKey) => base.deletePartition(container, partitionKey),
    async put(container, partitionKey, id, body, opts) {
      if (id === failId) {
        throw new Error('simulated store failure');
      }
      return base.put(container, partitionKey, id, body, opts);
    },
  };
}

/** A store whose `put` always rejects the migration-state doc with a CAS conflict. */
function conflictingStateStore(base: DocumentStore): DocumentStore {
  return {
    get: (container, partitionKey, id) => base.get(container, partitionKey, id),
    getEnvelope: (container, partitionKey, id) => base.getEnvelope(container, partitionKey, id),
    list: (container, partitionKey, opts) => base.list(container, partitionKey, opts),
    remove: (container, partitionKey, id) => base.remove(container, partitionKey, id),
    removeByParent: (container, partitionKey, parentId) => base.removeByParent(container, partitionKey, parentId),
    deletePartition: (container, partitionKey) => base.deletePartition(container, partitionKey),
    async put(container, partitionKey, id, body, opts) {
      if (container === 'system' && id === 'state') {
        throw new DocumentConflictError();
      }
      return base.put(container, partitionKey, id, body, opts);
    },
  };
}

const SQLITE_RUN = { backend: 'sqlite' as const };

describe('runStorageMigration — singleton containers', () => {
  it('migrates a skills singleton with a body matching the legacy source', async () => {
    const store = createFileDocumentStore();
    const legacy = { level: 'intermediate', topics: ['testing'] };
    await seedLegacyFile('alice', 'skills-profile.json', legacy);

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.inserted).toBe(1);
    expect(summary.status).toBe('successful');
    const envelope = await store.getEnvelope('skills', 'alice', 'current');
    expect(envelope).not.toBeNull();
    expect(canonicalizeBody(envelope!.body)).toBe(canonicalizeBody(legacy));
  });

  it('migrates all five singleton containers in one run', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'beginner' });
    await seedLegacyFile('alice', 'habits.json', { streak: 3 });
    await seedLegacyFile('alice', 'focus-storage.json', { focus: 'go' });
    await seedLegacyFile('alice', 'profile-cache.json', { login: 'alice' });
    await seedLegacyFile('alice', 'challenge-queue.json', { challenges: [], lastUpdated: 'x' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.inserted).toBe(5);
    for (const container of ['skills', 'habits', 'focus', 'profile', 'challenge-queue'] as const) {
      expect(await store.getEnvelope(container, 'alice', 'current')).not.toBeNull();
    }
  });
});

describe('runStorageMigration — by-id containers', () => {
  it('migrates a by-id challenge spec', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'challenges/chal-1.json', { title: 'Reverse a string' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.inserted).toBe(1);
    expect(await store.getEnvelope('challenges', 'alice', 'chal-1')).not.toBeNull();
  });

  it('reassembles a multi-file workspace identically to the shared leaf', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'workspaces/chal-1/_workspace.json', workspaceMetadata('chal-1', ['a.ts', 'b.ts']));
    await seedLegacyFile('alice', 'workspaces/chal-1/a.ts', 'export const a = 1;');
    await seedLegacyFile('alice', 'workspaces/chal-1/b.ts', 'export const b = 2;');

    await runStorageMigration({ ...SQLITE_RUN, store });

    const envelope = await store.getEnvelope('workspaces', 'alice', 'chal-1');
    expect(envelope).not.toBeNull();
    const expected = await readLegacyWorkspaceTree(
      (relativePath) => fs.readFile(path.join(TEST_DATA_DIR, 'users', 'alice', relativePath), 'utf8').catch(() => null),
      () => {},
      'alice',
      'chal-1',
    );
    expect(canonicalizeBody(envelope!.body)).toBe(canonicalizeBody(expected));
  });

  it('skips a challenge spec with an unsafe id without migrating it', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'challenges/ok.json', { title: 'kept' });
    await seedLegacyFile('alice', 'challenges/..evil.json', { title: 'dropped' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.inserted).toBe(1);
    expect(await store.getEnvelope('challenges', 'alice', 'ok')).not.toBeNull();
  });
});

describe('runStorageMigration — conflict policy', () => {
  it('is idempotent: a re-run reports the document unchanged', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    const first = await runStorageMigration({ ...SQLITE_RUN, store });
    const second = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(first.counts.inserted).toBe(1);
    expect(second.counts.inserted).toBe(0);
    expect(second.counts.unchanged).toBe(1);
    expect(second.status).toBe('successful');
  });

  it('skips a divergent envelope without --force', async () => {
    const store = createFileDocumentStore();
    await store.put('skills', 'alice', 'current', { level: 'advanced' }, { ifNoneMatch: '*' });
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'beginner' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.skippedDivergent).toBe(1);
    expect(summary.status).toBe('completedWithSkips');
    const envelope = await store.getEnvelope('skills', 'alice', 'current');
    expect((envelope!.body as { level: string }).level).toBe('advanced');
  });

  it('overwrites a divergent envelope with --force', async () => {
    const store = createFileDocumentStore();
    await store.put('skills', 'alice', 'current', { level: 'advanced' }, { ifNoneMatch: '*' });
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'beginner' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store, force: true });

    expect(summary.counts.overwritten).toBe(1);
    const envelope = await store.getEnvelope('skills', 'alice', 'current');
    expect((envelope!.body as { level: string }).level).toBe('beginner');
  });
});

describe('runStorageMigration — corrupt and absent sources', () => {
  it('counts an unparseable legacy file as skippedCorrupt', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', '{not valid json');

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.skippedCorrupt).toBe(1);
    expect(summary.counts.inserted).toBe(0);
    expect(summary.status).toBe('completedWithSkips');
  });

  it('counts a workspace dir with no metadata sidecar as skippedCorrupt', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'workspaces/chal-1/a.ts', 'orphan file, no metadata');

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.skippedCorrupt).toBe(1);
    expect(await store.getEnvelope('workspaces', 'alice', 'chal-1')).toBeNull();
  });

  it('counts a workspace with a malformed file entry as skippedCorrupt', async () => {
    const store = createFileDocumentStore();
    // A sidecar whose `files` array carries a non-string `name` would crash the
    // reassembly path; the importer must treat it as a skip, not abort.
    await seedLegacyFile('alice', 'workspaces/chal-1/_workspace.json', {
      version: 1,
      challengeId: 'chal-1',
      activeFileId: 'file-a',
      files: [{ id: 'file-a', name: 42, language: 'typescript', createdAt: 1, updatedAt: 2 }],
    });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.skippedCorrupt).toBe(1);
    expect(await store.getEnvelope('workspaces', 'alice', 'chal-1')).toBeNull();
  });

  it('skips a user tombstoned before the run and processes none of their docs', async () => {
    const store = createFileDocumentStore();
    // Unique userId avoids the module-level tombstoneCache pollution that the
    // on-disk-only beforeEach wipe cannot reach.
    await seedLegacyFile('ghost', 'skills-profile.json', { level: 'intermediate' });
    const tombstonePath = path.join(TEST_DATA_DIR, 'tombstones', 'ghost');
    await fs.mkdir(path.dirname(tombstonePath), { recursive: true });
    await fs.writeFile(tombstonePath, new Date().toISOString(), 'utf8');

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.usersProcessed).toBe(0);
    expect(summary.counts.inserted).toBe(0);
    expect(await store.getEnvelope('skills', 'ghost', 'current')).toBeNull();
  });
});

describe('runStorageMigration — tenancy and selection', () => {
  it('migrates only the requested user when --user is set', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'a' });
    await seedLegacyFile('bob', 'skills-profile.json', { level: 'b' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store, user: 'alice' });

    expect(summary.usersProcessed).toBe(1);
    expect(await store.getEnvelope('skills', 'alice', 'current')).not.toBeNull();
    expect(await store.getEnvelope('skills', 'bob', 'current')).toBeNull();
  });

  it('refuses a path-traversing --user value without enumerating any user', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'a' });

    await expect(runStorageMigration({ ...SQLITE_RUN, store, user: '../evil' })).rejects.toBeInstanceOf(
      StorageMigrationUserError,
    );
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });

  it('skips a user tombstoned between the up-front filter and their first document', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('gate-victim', 'skills-profile.json', { level: 'a' });

    // The seam fires twice for a single user: call 1 is the up-front
    // excludeTombstonedUsers filter (still live), call 2 is the per-user gate
    // immediately before iterating their documents (now tombstoned). The gate is
    // a performance shortcut — it skips descriptor.enumerateIds for a user already
    // known deleted; the pre-write re-check is the actual correctness guard. This
    // test confirms the gate path exits early and the user is neither written nor
    // counted.
    let tombstoneChecks = 0;
    const isDeleted = async () => {
      tombstoneChecks += 1;
      return tombstoneChecks >= 2;
    };

    const summary = await runStorageMigration({ ...SQLITE_RUN, store, user: 'gate-victim', isDeleted });

    expect(summary.usersProcessed).toBe(0);
    expect(summary.counts.inserted).toBe(0);
    expect(await store.getEnvelope('skills', 'gate-victim', 'current')).toBeNull();
  });

  it('re-checks the tombstone before EACH write: writes doc 1, stops before doc 2', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('mid-clean', 'skills-profile.json', { level: 'a' });
    // mid-victim owns two migratable singletons. The descriptor order is
    // skills → habits (see MIGRATABLE_SINGLETON_FILENAMES), so skills/current is
    // doc 1 and habits/current is doc 2.
    await seedLegacyFile('mid-victim', 'skills-profile.json', { level: 'b' });
    await seedLegacyFile('mid-victim', 'habits.json', { streak: 7 });

    // For mid-victim the seam returns live for call 1 (up-front filter), call 2
    // (per-user gate), and call 3 (pre-write re-check before doc 1), then
    // tombstoned for call 4 (pre-write re-check before doc 2). mid-clean always
    // reads live. This proves the re-check repeats BETWEEN document writes: a
    // regression that checked once before the first write would write doc 2 too
    // and this test would fail on the non-null habits envelope.
    const checksByUser = new Map<string, number>();
    const isDeleted = async (userId: string) => {
      const checks = (checksByUser.get(userId) ?? 0) + 1;
      checksByUser.set(userId, checks);
      return userId === 'mid-victim' && checks >= 4;
    };

    const summary = await runStorageMigration({ ...SQLITE_RUN, store, isDeleted });

    expect(summary.usersProcessed).toBe(1);
    expect(await store.getEnvelope('skills', 'mid-clean', 'current')).not.toBeNull();
    // Doc 1 was written before the flip; doc 2 was stopped by the per-write re-check.
    expect(await store.getEnvelope('skills', 'mid-victim', 'current')).not.toBeNull();
    expect(await store.getEnvelope('habits', 'mid-victim', 'current')).toBeNull();
  });
});

describe('runStorageMigration — dry run', () => {
  it('reports counts without writing envelopes or the state document', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store, dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.counts.inserted).toBe(1);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
    expect(await store.getEnvelope('system', 'migration-storage-v1', 'state')).toBeNull();
  });
});

describe('runStorageMigration — state document', () => {
  it('persists the migration-state summary on a non-dry run', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    await runStorageMigration({ ...SQLITE_RUN, store });

    const state = await store.getEnvelope('system', 'migration-storage-v1', 'state');
    expect(state).not.toBeNull();
    expect((state!.body as { status: string }).status).toBe('successful');
  });

  it('rethrows the CAS conflict when the state document cannot be persisted after retries', async () => {
    const store = conflictingStateStore(createFileDocumentStore());
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    await expect(runStorageMigration({ ...SQLITE_RUN, store })).rejects.toBeInstanceOf(DocumentConflictError);
    // The advisory lock must still be released even when state persistence throws.
    await expect(fs.access(LOCK_PATH)).rejects.toThrow();
  });
});

describe('releaseLock — owner guard', () => {
  it('does not delete a lock file owned by a different owner', async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
    await fs.writeFile(
      LOCK_PATH,
      JSON.stringify({ ownerId: 'someone-else', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      'utf8',
    );

    await releaseLock({ filePath: LOCK_PATH, ownerId: 'me' });

    await expect(fs.access(LOCK_PATH)).resolves.toBeUndefined();
  });

  it('deletes the lock file when the caller still owns it', async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
    await fs.writeFile(
      LOCK_PATH,
      JSON.stringify({ ownerId: 'me', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
      'utf8',
    );

    await releaseLock({ filePath: LOCK_PATH, ownerId: 'me' });

    await expect(fs.access(LOCK_PATH)).rejects.toThrow();
  });
});

describe('runStorageMigration — failures', () => {
  it('records a non-conflict store error as a failure and reports completedWithFailures', async () => {
    const base = createFileDocumentStore();
    const store = failingPutStore(base, 'current');
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    const summary = await runStorageMigration({ ...SQLITE_RUN, store });

    expect(summary.counts.failures).toBe(1);
    expect(summary.status).toBe('completedWithFailures');
  });
});

describe('runStorageMigration — file backend guard', () => {
  it('refuses a file-backend run without assumeQuiesced', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    await expect(runStorageMigration({ backend: 'file', store })).rejects.toBeInstanceOf(StorageMigrationRefusedError);
    expect(await store.getEnvelope('skills', 'alice', 'current')).toBeNull();
  });

  it('runs a file-backend migration when assumeQuiesced is set', async () => {
    const store = createFileDocumentStore();
    await seedLegacyFile('alice', 'skills-profile.json', { level: 'intermediate' });

    const summary = await runStorageMigration({ backend: 'file', store, assumeQuiesced: true });

    expect(summary.counts.inserted).toBe(1);
    expect(await store.getEnvelope('skills', 'alice', 'current')).not.toBeNull();
  });
});
