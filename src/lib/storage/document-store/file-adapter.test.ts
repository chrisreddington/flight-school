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
import { DocumentConflictError, SINGLETON_DOCUMENT_ID, type DocumentStore } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `flight-school-docstore-${Date.now()}`);

let createFileDocumentStore: (options?: { dataDir?: string }) => DocumentStore;
// Test seams exported from the adapter; imported via the same dynamic import so
// the module's lazy data-dir read still happens AFTER the env stub below.
let canonicalRootForLockKey: (resolvedRoot: string) => string;
let withDocumentLock: <T>(lockKey: string, work: () => Promise<T>) => Promise<T>;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  ({ createFileDocumentStore, canonicalRootForLockKey, withDocumentLock } = await import('./file-adapter'));
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

  it('lazily creates a deeply-nested, not-yet-existent dataDir on first write', async () => {
    // Guards #lockedIo's root-materialisation step (the lock-key TOCTOU fix for
    // lazily-created roots): a put against a root whose parents do not yet exist
    // must still create the tree and round-trip.
    const base = path.join(os.tmpdir(), `flight-school-lazy-${Date.now()}`);
    const nestedRoot = path.join(base, 'a', 'b', 'c');
    try {
      const store = createFileDocumentStore({ dataDir: nestedRoot });
      await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { label: 'lazy' });
      expect(await store.get('skills', 'user-a', SINGLETON_DOCUMENT_ID)).toEqual({ label: 'lazy' });
    } finally {
      await fs.rm(base, { recursive: true, force: true });
    }
  });
});

describe('FileDocumentStore concurrent-CAS harness is non-vacuous', () => {
  it('a lock-free read-check-write over the same document lets both writers pass the etag check', async () => {
    // Positive control for the one-winner CAS assertions in the shared contract.
    // It reproduces the adapter's ifMatch substrate (read envelope, compare etag,
    // write) but WITHOUT withDocumentLock, in two explicit phases so the proof
    // makes no libuv-scheduling assumption:
    //   phase 1 — run both reads and await BOTH; assert each saw the seeded etag
    //             (i.e. without serialisation both writers pass the check the
    //              real adapter performs);
    //   phase 2 — run both raw writes.
    // The real adapter's lock is the only thing that would interleave a read
    // after the other's write and so collapse this to one winner. (A barrier that
    // forced "both reads before either write" INSIDE the locked path cannot
    // exist — the lock serialises the whole read-check-write, so the second read
    // waits behind the first write and such a barrier would deadlock. Running the
    // substrate lock-free is the deterministic alternative.)
    const store = createFileDocumentStore();
    const seeded = await store.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 0 });
    const ops = createStorageFileOps(() => TEST_STORAGE_DIR);

    const reads = await Promise.all([
      store.getEnvelope<{ value: number }>('skills', 'user-a', SINGLETON_DOCUMENT_ID),
      store.getEnvelope<{ value: number }>('skills', 'user-a', SINGLETON_DOCUMENT_ID),
    ]);
    expect(reads.every((envelope) => envelope?.etag === seeded.etag)).toBe(true);

    await Promise.all(
      [1, 2].map((value) =>
        ops.writeFile(
          '_docstore/skills/user-a',
          `${SINGLETON_DOCUMENT_ID}.json`,
          JSON.stringify({ body: { value }, metadata: {}, etag: randomUUID(), updatedAt: new Date().toISOString() }),
        ),
      ),
    );

    // Both lock-free writes landed: a value persists (one of them won the rename
    // race), confirming the substrate genuinely admits two writers absent a lock.
    const persisted = await store.get<{ value: number }>('skills', 'user-a', SINGLETON_DOCUMENT_ID);
    expect([1, 2]).toContain(persisted?.value);
  });

  it('shares one lock between symlinked and canonical spellings of the same dataDir', async () => {
    // Targeted regression test for canonicalRootForLockKey: two instances spell
    // the SAME physical directory differently (one via a symlink alias), so a
    // lexical lock key would give them separate mutexes and let both win the CAS
    // race. The canonical key must collapse them to one winner.
    const symlinkDir = path.join(os.tmpdir(), `flight-school-symlink-${Date.now()}`);
    await fs.symlink(TEST_STORAGE_DIR, symlinkDir);
    try {
      const storeReal = createFileDocumentStore({ dataDir: TEST_STORAGE_DIR });
      const storeSymlink = createFileDocumentStore({ dataDir: symlinkDir });
      const seeded = await storeReal.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 0 });

      const outcomes = await Promise.allSettled([
        storeReal.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 1 }, { ifMatch: seeded.etag }),
        storeSymlink.put('skills', 'user-a', SINGLETON_DOCUMENT_ID, { value: 2 }, { ifMatch: seeded.etag }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(rejected).toHaveLength(1);
      // The loser must fail as a CAS conflict, not some incidental error (e.g. an
      // EACCES from canonicalisation), which would make the one-winner assertion
      // pass for the wrong reason.
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);
    } finally {
      await fs.unlink(symlinkDir);
    }
  });
});

describe('FileDocumentStore lock-key determinism', () => {
  it('derives an identical lock-key root for a symlinked and canonical spelling of one dir', async () => {
    // Airtight, timing-free regression for canonicalRootForLockKey: two spellings
    // of the SAME physical directory MUST canonicalise to a byte-identical root,
    // since that root is what namespaces the write lock. A lexical key would
    // differ here and re-open the dual-winner CAS race the symlink test guards.
    const symlinkDir = path.join(os.tmpdir(), `flight-school-keyeq-${Date.now()}`);
    await fs.symlink(TEST_STORAGE_DIR, symlinkDir);
    try {
      expect(canonicalRootForLockKey(symlinkDir)).toBe(canonicalRootForLockKey(TEST_STORAGE_DIR));
    } finally {
      await fs.unlink(symlinkDir);
    }
  });

  it('derives different lock-key roots for genuinely different dirs', async () => {
    const otherDir = path.join(os.tmpdir(), `flight-school-keyeq-other-${Date.now()}`);
    await fs.mkdir(otherDir, { recursive: true });
    try {
      expect(canonicalRootForLockKey(otherDir)).not.toBe(canonicalRootForLockKey(TEST_STORAGE_DIR));
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true });
    }
  });
});

describe('withDocumentLock serialises by key', () => {
  it('runs two ops that share a key strictly one after the other', async () => {
    // Deterministic proof that a shared lock key serialises critical sections,
    // with no reliance on libuv scheduling: op A enters and parks on a gate the
    // test controls, so op B (same key) cannot enter until A is released.
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const aDone = withDocumentLock('shared-key', async () => {
      order.push('A-enter');
      await aGate;
      order.push('A-exit');
    });
    const bDone = withDocumentLock('shared-key', async () => {
      order.push('B-run');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['A-enter']); // B is parked behind A, not run

    releaseA();
    await Promise.all([aDone, bDone]);
    expect(order).toEqual(['A-enter', 'A-exit', 'B-run']);
  });

  it('runs two ops under different keys concurrently', async () => {
    // Negative control: distinct keys must NOT serialise, so B completes while A
    // is still parked. This is what proves the serialisation above is the key's
    // doing, not an artefact of the harness.
    const order: string[] = [];
    let releaseA: () => void = () => {};
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const aDone = withDocumentLock('key-a', async () => {
      order.push('A-enter');
      await aGate;
      order.push('A-exit');
    });
    const bDone = withDocumentLock('key-b', async () => {
      order.push('B-run');
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['A-enter', 'B-run']); // B did not wait on A's gate

    releaseA();
    await Promise.all([aDone, bDone]);
    expect(order).toEqual(['A-enter', 'B-run', 'A-exit']);
  });
});
