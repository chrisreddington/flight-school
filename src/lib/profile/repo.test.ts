/**
 * Tests for the profile-cache singleton repository.
 *
 * The generic singleton guarantees (construction throw, tenancy, legacy
 * read-through, …) are covered by
 * {@link import('../storage/document-store/singleton-repo.test')}. This suite
 * pins the profile-specific contract:
 *
 * - **Nullable schema guard**: {@link isProfileStorageSchema} admits `null`
 *   (the default, "no cache yet") alongside a well-formed `{ date, profile }`
 *   record, and is the single source of truth the route reuses.
 * - **Nullable default + no stamp**: a fresh user reads back `null`, and a
 *   round-tripped body survives verbatim through the same `filename`/`guard`
 *   the route persists with.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module profile/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProfileStorageSchema } from './repo';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-profile-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variant under test never calls it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let profileRepo: typeof import('./repo').profileRepo;
let isProfileStorageSchema: typeof import('./repo').isProfileStorageSchema;
let userStorage: typeof import('../storage/user-storage');

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ profileRepo, isProfileStorageSchema } = await import('./repo'));
  userStorage = await import('../storage/user-storage');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

/** Minimal record the guard accepts; the guard only checks `profile` is an object. */
const SAMPLE_CACHE = {
  date: '2026-05-30',
  profile: { user: { login: 'octocat' } },
} as unknown as ProfileStorageSchema;

describe('isProfileStorageSchema', () => {
  it('accepts null (no cache yet)', () => {
    expect(isProfileStorageSchema(null)).toBe(true);
  });

  it('accepts a well-formed date/profile record', () => {
    expect(isProfileStorageSchema(SAMPLE_CACHE)).toBe(true);
  });

  it('rejects non-objects and malformed records', () => {
    expect(isProfileStorageSchema('nope')).toBe(false);
    expect(isProfileStorageSchema({})).toBe(false);
    expect(isProfileStorageSchema({ date: 7, profile: {} })).toBe(false);
    expect(isProfileStorageSchema({ date: '2026-05-30', profile: null })).toBe(false);
  });
});

describe('profileRepo metadata', () => {
  it('exposes the singleton filename, null default, and guard the route reuses', () => {
    expect(profileRepo.filename).toBe('profile-cache.json');
    expect(profileRepo.defaultValue).toBeNull();
    expect(profileRepo.guard).toBe(isProfileStorageSchema);
  });
});

describe('profileRepo round-trip', () => {
  it('returns the null default for a user with no cached profile', async () => {
    expect(await profileRepo.read('profile-empty-user')).toBeNull();
  });

  it('persists and reads back a record without stamping', async () => {
    const written = await profileRepo.write('profile-rt-user', SAMPLE_CACHE);
    expect(written).toBe(SAMPLE_CACHE);

    const read = await profileRepo.read('profile-rt-user');
    expect(read).toEqual(SAMPLE_CACHE);
  });
});

describe('profile storage route parity', () => {
  it('persists a client body verbatim through the *ForUser write the route uses', async () => {
    await userStorage.writeUserStorageForUser<ProfileStorageSchema | null>(
      'profile-route-user',
      profileRepo.filename,
      SAMPLE_CACHE,
      profileRepo.guard,
    );

    const read = await profileRepo.read('profile-route-user');
    expect(read).toEqual(SAMPLE_CACHE);
  });
});
