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
let assertNodeSupportsSqlite: typeof import('./factory').assertNodeSupportsSqlite;
let SENTINEL_FILENAME: string;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  ({ createDocumentStore, resolveStorageBackend, assertNodeSupportsSqlite } = await import('./factory'));
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

describe('resolveStorageBackend', () => {
  it('defaults to file when STORAGE_BACKEND is unset, empty, or "file"', () => {
    expect(resolveStorageBackend(undefined)).toBe('file');
    expect(resolveStorageBackend('')).toBe('file');
    expect(resolveStorageBackend('  ')).toBe('file');
    expect(resolveStorageBackend('FILE')).toBe('file');
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

    expect(createSqliteSpy).not.toHaveBeenCalled();
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
    expect(createSqliteSpy).not.toHaveBeenCalled();
  });

  it('selects the backend from STORAGE_BACKEND when no explicit backend is passed', async () => {
    vi.stubEnv('STORAGE_BACKEND', 'file');
    await createDocumentStore();
    expect(await readSentinelBackend()).toBe('file');
    expect(createSqliteSpy).not.toHaveBeenCalled();
  });

  it('constructs the sqlite adapter only on the sqlite backend, passing the data-dir db path', async () => {
    await createDocumentStore({ backend: 'sqlite' });

    expect(createSqliteSpy).toHaveBeenCalledTimes(1);
    const passedPath = createSqliteSpy.mock.calls[0][0].dbPath as string;
    expect(passedPath.startsWith(TEST_STORAGE_DIR)).toBe(true);
    expect(passedPath.endsWith('.sqlite')).toBe(true);
    expect(await readSentinelBackend()).toBe('sqlite');
  });
});
