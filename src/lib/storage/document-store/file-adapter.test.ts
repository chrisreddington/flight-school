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

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeDocumentStoreContract } from './contract';
import { DocumentConflictError, SINGLETON_DOCUMENT_ID, type DocumentStore } from './types';

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

describeDocumentStoreContract('file', () => createFileDocumentStore());

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

describe('FileDocumentStore concurrent ifMatch CAS', () => {
  it('resolves two concurrent stale-etag updates to exactly one winner', async () => {
    const store = createFileDocumentStore();
    const seeded = await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 0 });

    // Both writers hold the SAME pre-race etag, so absent a per-document lock the
    // read-check-write windows could interleave and BOTH could win. The lock
    // serialises them: the first commits, the second observes the advanced etag.
    const outcomes = await Promise.allSettled([
      store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 1 }, { ifMatch: seeded.etag }),
      store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 2 }, { ifMatch: seeded.etag }),
    ]);

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);

    // The surviving document is whichever writer won — never a torn or lost write.
    const persisted = await store.get<{ value: number }>('skills', 'user-a', SINGLETON_DOCUMENT_ID);
    expect([1, 2]).toContain(persisted?.value);
  });
});
