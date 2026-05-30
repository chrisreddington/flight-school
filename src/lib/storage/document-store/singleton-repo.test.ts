/**
 * Tests for the typed per-user singleton repository factory.
 *
 * {@link createSingletonRepo} is the pattern every domain singleton (skills,
 * habits, focus, profile, challenge-queue) builds on, so its guarantees are
 * load-bearing across the app:
 *
 * - **Parity**: a stampless repo must persist byte-identical state to
 *   {@link import('../user-storage').writeUserStorageForUser} for the same
 *   mapped filename — they share `buildCompatDeps` + `writeMappedDoc`, and this
 *   test pins that they cannot diverge (rubber-duck finding #2: stamping is the
 *   ONLY intended difference between the two write paths).
 * - **Tenancy**: two users' singletons of the same filename never collide.
 * - **Safety**: an unsafe `userId` throws before any path is built; an unmapped
 *   filename throws at construction (a programming error, surfaced at load).
 * - **Read-through precedence**: the envelope store shadows a legacy file once
 *   present (delegated to the compat core, re-pinned here through the repo).
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load, so
 * the modules are dynamic-imported after the env stub) with only the tombstone
 * seam mocked.
 *
 * @module storage/document-store/singleton-repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SchemaGuard } from './user-storage-core';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-singleton-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variants under test never call it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

interface SampleDoc {
  value: string;
  lastUpdated: string;
}

const DEFAULT_DOC: SampleDoc = { value: '', lastUpdated: '' };

const isSampleDoc: SchemaGuard<SampleDoc> = (data): data is SampleDoc => {
  if (typeof data !== 'object' || data === null) return false;
  const candidate = data as Record<string, unknown>;
  return typeof candidate.value === 'string' && typeof candidate.lastUpdated === 'string';
};

/** A mapped singleton filename reused across the parity and tenancy cases. */
const MAPPED_FILENAME = 'skills-profile.json';

let createSingletonRepo: typeof import('./singleton-repo').createSingletonRepo;
let userStorage: typeof import('../user-storage');
let readFile: typeof import('../utils').readFile;
let writeFile: typeof import('../utils').writeFile;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ createSingletonRepo } = await import('./singleton-repo'));
  userStorage = await import('../user-storage');
  ({ readFile, writeFile } = await import('../utils'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('createSingletonRepo construction', () => {
  it('throws when the filename is not a mapped singleton', () => {
    expect(() =>
      createSingletonRepo<SampleDoc>({
        filename: 'not-a-real-singleton.json',
        defaultValue: DEFAULT_DOC,
        guard: isSampleDoc,
      }),
    ).toThrow(/not a mapped singleton/);
  });

  it('exposes filename, defaultValue, and guard for routes to reuse', () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    expect(repo.filename).toBe(MAPPED_FILENAME);
    expect(repo.defaultValue).toBe(DEFAULT_DOC);
    expect(repo.guard).toBe(isSampleDoc);
  });
});

describe('createSingletonRepo unsafe userId', () => {
  const repo = (): ReturnType<typeof createSingletonRepo<SampleDoc>> =>
    createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });

  it('rejects read/write/remove for a path-unsafe userId', async () => {
    const unsafe = '../escape';
    await expect(repo().read(unsafe)).rejects.toThrow(/unsafe userId/i);
    await expect(repo().write(unsafe, { value: 'x', lastUpdated: 'y' })).rejects.toThrow(/unsafe userId/i);
    await expect(repo().remove(unsafe)).rejects.toThrow(/unsafe userId/i);
  });
});

describe('createSingletonRepo round-trip and defaults', () => {
  it('read returns the default when nothing is stored', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    expect(await repo.read('repo-empty-user')).toEqual(DEFAULT_DOC);
  });

  it('write persists and read returns the stored body (stampless)', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    const body: SampleDoc = { value: 'hello', lastUpdated: '2026-01-01' };
    const written = await repo.write('repo-roundtrip-user', body);
    expect(written).toEqual(body);
    expect(await repo.read('repo-roundtrip-user')).toEqual(body);
  });

  it('remove deletes the stored document', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    await repo.write('repo-remove-user', { value: 'gone soon', lastUpdated: 'now' });
    await repo.remove('repo-remove-user');
    expect(await repo.read('repo-remove-user')).toEqual(DEFAULT_DOC);
  });
});

describe('createSingletonRepo write-time stamp', () => {
  it('stamps the body before persisting and returns the stamped value', async () => {
    let counter = 0;
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
      stamp: (body) => ({ ...body, lastUpdated: `stamp-${++counter}` }),
    });
    const written = await repo.write('repo-stamp-user', { value: 'v', lastUpdated: 'client-set' });
    expect(written.lastUpdated).toBe('stamp-1');
    expect(await repo.read('repo-stamp-user')).toEqual({ value: 'v', lastUpdated: 'stamp-1' });
  });
});

describe('createSingletonRepo tenancy isolation', () => {
  it('keeps two users\u2019 singletons of the same filename separate', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    await repo.write('repo-alice', { value: 'alice-data', lastUpdated: 'a' });
    await repo.write('repo-bob', { value: 'bob-data', lastUpdated: 'b' });
    expect((await repo.read('repo-alice')).value).toBe('alice-data');
    expect((await repo.read('repo-bob')).value).toBe('bob-data');
  });
});

describe('createSingletonRepo parity with writeUserStorageForUser', () => {
  it('persists state a stampless *UserStorageForUser read sees identically', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    const body: SampleDoc = { value: 'parity', lastUpdated: 'fixed' };

    await repo.write('repo-parity-a', body);
    const viaCore = await userStorage.readUserStorageForUser<SampleDoc>(
      'repo-parity-a',
      MAPPED_FILENAME,
      DEFAULT_DOC,
      isSampleDoc,
    );
    expect(viaCore).toEqual(body);

    await userStorage.writeUserStorageForUser<SampleDoc>('repo-parity-b', MAPPED_FILENAME, body, isSampleDoc);
    expect(await repo.read('repo-parity-b')).toEqual(body);
  });
});

describe('createSingletonRepo legacy read-through precedence', () => {
  it('serves a healthy legacy file, then the envelope shadows it once written', async () => {
    const repo = createSingletonRepo<SampleDoc>({
      filename: MAPPED_FILENAME,
      defaultValue: DEFAULT_DOC,
      guard: isSampleDoc,
    });
    const userId = 'repo-legacy-user';
    const legacyBody: SampleDoc = { value: 'from-legacy', lastUpdated: 'legacy' };
    await writeFile(`users/${userId}`, MAPPED_FILENAME, JSON.stringify(legacyBody));

    // No envelope yet: the healthy legacy file is handed back as-is.
    expect(await repo.read(userId)).toEqual(legacyBody);

    // Once an envelope exists it shadows the (still-present) legacy file.
    const envelopeBody: SampleDoc = { value: 'from-envelope', lastUpdated: 'envelope' };
    await repo.write(userId, envelopeBody);
    expect(await repo.read(userId)).toEqual(envelopeBody);

    // remove() clears BOTH the envelope and the shadowed legacy file, so the
    // returning reader cannot resurrect stale legacy content.
    await repo.remove(userId);
    expect(await repo.read(userId)).toEqual(DEFAULT_DOC);
    expect(await readFile(`users/${userId}`, MAPPED_FILENAME)).toBeNull();
  });
});
