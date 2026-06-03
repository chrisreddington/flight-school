/**
 * Tests for the storage-backend factory (§0.1, §0.5).
 *
 * Two invariants matter most here:
 *   - the `file` default never loads `node:sqlite` (so Node < 22.13 keeps
 *     working), proven by asserting the sqlite-adapter module is never reached
 *     on the file branch — that adapter is the sole importer of `node:sqlite`,
 *     so "adapter untouched" is a faithful proxy for "driver never required";
 *   - the sentinel is reconciled before any adapter opens, recording the
 *     selected backend so two processes cannot silently split-brain.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-factory-${Date.now()}`);

const createSqliteSpy = vi.fn(async () => ({ marker: 'sqlite-store' }) as never);

// Replace the sqlite adapter so reaching it is observable and so the suite
// never depends on the real `node:sqlite` driver. The file branch must NOT
// call this mock; the sqlite branch must.
vi.mock('./sqlite-adapter', () => ({
  createSqliteDocumentStore: createSqliteSpy,
}));

let createDocumentStore: typeof import('./factory').createDocumentStore;
let resolveStorageBackend: typeof import('./factory').resolveStorageBackend;
let resolveEffectiveBackend: typeof import('./factory').resolveEffectiveBackend;
let assertNodeSupportsSqlite: typeof import('./factory').assertNodeSupportsSqlite;
let getDocumentStore: typeof import('./factory').getDocumentStore;
let SENTINEL_FILENAME: string;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  ({ createDocumentStore, resolveStorageBackend, resolveEffectiveBackend, assertNodeSupportsSqlite, getDocumentStore } =
    await import('./factory'));
  ({ SENTINEL_FILENAME } = await import('./backend-sentinel'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  createSqliteSpy.mockClear();
  vi.unstubAllEnvs();
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function readSentinelBackend(): Promise<string> {
  const raw = await fs.readFile(path.join(TEST_STORAGE_DIR, SENTINEL_FILENAME), 'utf-8');
  return JSON.parse(raw).backend;
}

/** Seed an existing sentinel so the data dir is "committed" to a backend. */
async function seedSentinel(backend: 'file' | 'sqlite'): Promise<void> {
  await fs.writeFile(
    path.join(TEST_STORAGE_DIR, SENTINEL_FILENAME),
    `${JSON.stringify({ backend, schemaVersion: 1 })}\n`,
    'utf-8',
  );
}

describe('getDocumentStore memoisation', () => {
  it('does not cache a rejected construction, so a later call retries', async () => {
    // A bogus STORAGE_BACKEND makes the first construction reject. The memo
    // must clear itself on rejection so a corrected backend can still resolve,
    // rather than serving the poisoned rejection for the life of the process.
    vi.stubEnv('STORAGE_BACKEND', 'not-a-backend');
    await expect(getDocumentStore()).rejects.toThrow(/STORAGE_BACKEND/);

    vi.stubEnv('STORAGE_BACKEND', 'file');
    const store = await getDocumentStore();
    await store.put('system', 'p1', 'doc', { ok: true });
    expect(await store.get('system', 'p1', 'doc')).toEqual({ ok: true });
  });
});

describe('resolveStorageBackend', () => {
  it('defaults to sqlite when STORAGE_BACKEND is unset or empty', () => {
    expect(resolveStorageBackend(undefined)).toBe('sqlite');
    expect(resolveStorageBackend('')).toBe('sqlite');
    expect(resolveStorageBackend('  ')).toBe('sqlite');
  });

  it('still honours an explicit file backend case-insensitively', () => {
    expect(resolveStorageBackend('file')).toBe('file');
    expect(resolveStorageBackend('FILE')).toBe('file');
    expect(resolveStorageBackend(' File ')).toBe('file');
  });

  it('selects sqlite case-insensitively', () => {
    expect(resolveStorageBackend('sqlite')).toBe('sqlite');
    expect(resolveStorageBackend(' SQLite ')).toBe('sqlite');
  });

  it('rejects any other value rather than silently defaulting', () => {
    expect(() => resolveStorageBackend('postgres')).toThrow(/STORAGE_BACKEND/);
  });
});

describe('assertNodeSupportsSqlite', () => {
  it('accepts the minimum supported version and anything newer', () => {
    expect(() => assertNodeSupportsSqlite('22.13.0')).not.toThrow();
    expect(() => assertNodeSupportsSqlite('22.14.0')).not.toThrow();
    expect(() => assertNodeSupportsSqlite('26.0.0')).not.toThrow();
  });

  it('rejects versions below the minimum', () => {
    expect(() => assertNodeSupportsSqlite('22.12.0')).toThrow(/22\.13/);
    expect(() => assertNodeSupportsSqlite('20.0.0')).toThrow(/22\.13/);
    expect(() => assertNodeSupportsSqlite('18.19.1')).toThrow(/22\.13/);
  });
});

describe('createDocumentStore', () => {
  it('returns a working file store and never reaches the sqlite adapter on the file backend', async () => {
    const store = await createDocumentStore({ backend: 'file' });

    await store.put('system', 'p1', 'doc', { hello: 'world' });
    expect(await store.get('system', 'p1', 'doc')).toEqual({ hello: 'world' });

    expect(createSqliteSpy.mock.calls).toHaveLength(0);
    expect(await readSentinelBackend()).toBe('file');
  });

  it('reconciles the sentinel before opening the adapter', async () => {
    await createDocumentStore({ backend: 'file' });
    expect(await readSentinelBackend()).toBe('file');
  });

  it('refuses to start when the sentinel is committed to a different backend', async () => {
    await createDocumentStore({ backend: 'file' });
    await expect(createDocumentStore({ backend: 'sqlite' })).rejects.toThrow(/backend mismatch/i);
    // The mismatch is caught before the sqlite adapter is ever constructed.
    expect(createSqliteSpy.mock.calls).toHaveLength(0);
  });

  it('selects the backend from STORAGE_BACKEND when no explicit backend is passed', async () => {
    vi.stubEnv('STORAGE_BACKEND', 'file');
    await createDocumentStore();
    expect(await readSentinelBackend()).toBe('file');
    expect(createSqliteSpy.mock.calls).toHaveLength(0);
  });

  it('routes the file store to an explicit dataDir override', async () => {
    const overrideDir = path.join(os.tmpdir(), `fs-factory-override-${Date.now()}`);
    try {
      const store = await createDocumentStore({ backend: 'file', dataDir: overrideDir });
      await store.put('system', 'p1', 'doc', { routed: true });

      // The document lands under the override dir, not the env-stubbed root.
      const overridePath = path.join(overrideDir, '_docstore', 'system', 'p1', 'doc.json');
      const raw = JSON.parse(await fs.readFile(overridePath, 'utf-8'));
      expect(raw.body).toEqual({ routed: true });

      const rootPath = path.join(TEST_STORAGE_DIR, '_docstore', 'system', 'p1', 'doc.json');
      await expect(fs.readFile(rootPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });
});

describe('sentinel-wins resolution (default flip to sqlite)', () => {
  it('constructs a sqlite store for a fresh dir when STORAGE_BACKEND is unset', async () => {
    // The default flip: a brand-new data dir moves forward to sqlite without
    // any opt-in env, and records that choice in the sentinel.
    await createDocumentStore();

    expect(createSqliteSpy.mock.calls).toHaveLength(1);
    expect(await readSentinelBackend()).toBe('sqlite');
  });

  it('keeps an existing file-backed dir on file with no env set (the no-throw regression guard)', async () => {
    // A naive default flip would make this throw a backend mismatch on every
    // existing install. Sentinel-wins: the persisted backend is authoritative.
    await seedSentinel('file');

    const store = await createDocumentStore();
    await store.put('system', 'p1', 'doc', { kept: 'on-file' });
    expect(await store.get('system', 'p1', 'doc')).toEqual({ kept: 'on-file' });

    expect(createSqliteSpy.mock.calls).toHaveLength(0);
    expect(await readSentinelBackend()).toBe('file');
  });

  it('keeps an existing sqlite-backed dir on sqlite with no env set', async () => {
    await seedSentinel('sqlite');

    await createDocumentStore();

    expect(createSqliteSpy.mock.calls).toHaveLength(1);
    expect(await readSentinelBackend()).toBe('sqlite');
  });

  it('throws when STORAGE_BACKEND=file contradicts an existing sqlite sentinel', async () => {
    await seedSentinel('sqlite');
    vi.stubEnv('STORAGE_BACKEND', 'file');

    await expect(createDocumentStore()).rejects.toThrow(/backend mismatch/i);
    expect(createSqliteSpy.mock.calls).toHaveLength(0);
  });

  it('throws when STORAGE_BACKEND=sqlite contradicts an existing file sentinel', async () => {
    await seedSentinel('file');
    vi.stubEnv('STORAGE_BACKEND', 'sqlite');

    await expect(createDocumentStore()).rejects.toThrow(/backend mismatch/i);
    expect(createSqliteSpy.mock.calls).toHaveLength(0);
  });
});

describe('resolveEffectiveBackend', () => {
  it('returns sqlite for a fresh dir with no env (the process default)', async () => {
    expect(await resolveEffectiveBackend({ dataDir: TEST_STORAGE_DIR })).toBe('sqlite');
  });

  it('returns the persisted backend over the default when a sentinel exists', async () => {
    await seedSentinel('file');
    expect(await resolveEffectiveBackend({ dataDir: TEST_STORAGE_DIR })).toBe('file');
  });

  it('lets an explicit STORAGE_BACKEND pick the backend for a fresh dir', async () => {
    vi.stubEnv('STORAGE_BACKEND', 'file');
    expect(await resolveEffectiveBackend({ dataDir: TEST_STORAGE_DIR })).toBe('file');
  });

  it('throws when an explicit STORAGE_BACKEND contradicts the persisted sentinel', async () => {
    await seedSentinel('sqlite');
    vi.stubEnv('STORAGE_BACKEND', 'file');
    await expect(resolveEffectiveBackend({ dataDir: TEST_STORAGE_DIR })).rejects.toThrow(/backend mismatch/i);
  });

  it('does not treat a differing default as a mismatch — the sentinel silently wins', async () => {
    // No env set: the sqlite default differs from the file sentinel, but that
    // is forward movement, not an operator conflict, so it must not throw.
    await seedSentinel('file');
    await expect(resolveEffectiveBackend({ dataDir: TEST_STORAGE_DIR })).resolves.toBe('file');
  });
});
