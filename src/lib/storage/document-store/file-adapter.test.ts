/**
 * File-adapter tests: the shared {@link describeDocumentStoreContract} suite
 * plus file-backend-specific concerns (path-segment safety).
 *
 * The data dir is stubbed to an isolated temp directory **before** the adapter
 * (and the `../utils` primitives it wraps, which read the dir at module load)
 * are dynamically imported. Each test starts from an empty `_docstore`.
 *
 * @module storage/document-store/file-adapter.test
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStorageFileOps } from '../scoped-file-ops';
import { describeDocumentStoreContract } from './contract';
import { SINGLETON_DOCUMENT_ID, type DocumentStore } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `flight-school-docstore-${Date.now()}`);

let createFileDocumentStore: (options?: { dataDir?: string }) => DocumentStore;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  ({ createFileDocumentStore } = await import('./file-adapter'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
});

describeDocumentStoreContract('file', () => createFileDocumentStore(), {
  // Two instances over the same env-stubbed root exercise the process-wide
  // (module-level) lock that a per-instance lock would have missed.
  getPairedStores: async () => [createFileDocumentStore(), createFileDocumentStore()],
});

describe('FileDocumentStore path safety', () => {
  it('rejects an unsafe container segment', async () => {
    const store = createFileDocumentStore();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately bypassing the type to test runtime guard
      store.get('../escape' as any, 'user-a', SINGLETON_DOCUMENT_ID),
    ).rejects.toThrow(/unsafe container/);
  });

  it('rejects an unsafe partition segment', async () => {
    const store = createFileDocumentStore();
    await expect(store.get('skills', '../escape', SINGLETON_DOCUMENT_ID)).rejects.toThrow(/unsafe partitionKey/);
  });

  it('rejects an unsafe id segment', async () => {
    const store = createFileDocumentStore();
    await expect(store.get('skills', 'user-a', '../escape')).rejects.toThrow(/unsafe id/);
  });

  it('persists envelopes under the _docstore root', async () => {
    const store = createFileDocumentStore();
    await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'x' });
    const onDisk = path.join(TEST_STORAGE_DIR, '_docstore', 'skills', 'user-a', `${SINGLETON_DOCUMENT_ID}.json`);
    const raw = JSON.parse(await fs.readFile(onDisk, 'utf8'));
    expect(raw.body).toEqual({ label: 'x' });
    expect(raw.etag).toBeTruthy();
  });
});

describe('FileDocumentStore dataDir override', () => {
  it('routes writes to an explicit dataDir, not the process storage root', async () => {
    const overrideDir = path.join(os.tmpdir(), `flight-school-docstore-override-${Date.now()}`);
    try {
      const store = createFileDocumentStore({ dataDir: overrideDir });
      await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'override' });

      const overridePath = path.join(overrideDir, '_docstore', 'skills', 'user-a', `${SINGLETON_DOCUMENT_ID}.json`);
      const raw = JSON.parse(await fs.readFile(overridePath, 'utf8'));
      expect(raw.body).toEqual({ label: 'override' });

      // The env-stubbed root must stay untouched: the override is honoured, not ignored.
      const rootPath = path.join(TEST_STORAGE_DIR, '_docstore', 'skills', 'user-a', `${SINGLETON_DOCUMENT_ID}.json`);
      await expect(fs.readFile(rootPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      // Reads round-trip through the same instance root.
      expect(await store.get('skills', 'user-a', SINGLETON_DOCUMENT_ID)).toEqual({ label: 'override' });
    } finally {
      await fs.rm(overrideDir, { recursive: true, force: true });
    }
  });
});

describe('FileDocumentStore concurrent-CAS harness is non-vacuous', () => {
  it('a lock-free read-check-write over the same document yields TWO winners', async () => {
    // Positive control for the one-winner CAS assertions in the shared contract.
    // It mirrors the adapter's ifMatch path (read envelope, compare etag, write)
    // but WITHOUT withDocumentLock. A read (fs.readFile) never resolves
    // synchronously, so both reads below are GUARANTEED in-flight before either
    // write — both observe the seeded etag and both pass their check. The lock is
    // therefore the only thing that collapses this to one winner: if a regression
    // silently dropped it, the real adapter would behave exactly like this
    // control. (A barrier that instead forced "both reads before either write"
    // cannot exist with the lock present — the lock serialises the whole
    // read-check-write, so the second read waits behind the first write and such
    // a barrier would deadlock. This control is the deterministic alternative.)
    const store = createFileDocumentStore();
    const seeded = await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 0 });
    const ops = createStorageFileOps(() => TEST_STORAGE_DIR);

    async function lockFreeStaleUpdate(value: number): Promise<boolean> {
      const current = await store.getEnvelope<{ value: number }>('skills', 'user-a', SINGLETON_DOCUMENT_ID);
      if (!current || current.etag !== seeded.etag) return false;
      await ops.writeFile(
        '_docstore/skills/user-a',
        `${SINGLETON_DOCUMENT_ID}.json`,
        JSON.stringify({ body: { value }, metadata: {}, etag: randomUUID(), updatedAt: new Date().toISOString() }),
      );
      return true;
    }

    const passedCheck = await Promise.all([lockFreeStaleUpdate(1), lockFreeStaleUpdate(2)]);
    expect(passedCheck.filter(Boolean)).toHaveLength(2);
  });
});
