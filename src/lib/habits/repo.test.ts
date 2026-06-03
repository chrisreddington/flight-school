/**
 * Tests for the habits-collection singleton repository.
 *
 * The generic singleton guarantees (construction throw, tenancy, legacy
 * read-through, …) are covered by
 * {@link import('../storage/document-store/singleton-repo.test')}. This suite
 * pins the habits-specific contract:
 *
 * - **Schema guard**: {@link isHabitCollection} is the single source of truth
 *   for the persisted shape; a few accept/reject cases pin its contract.
 * - **No write-time stamp**: unlike `skillsRepo`, the collection carries no
 *   server-stamped field, so a round-tripped body survives verbatim — the RSC
 *   accessor, the Server Actions, and the storage route all persist the same
 *   bytes through the same `filename`/`guard`.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module habits/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HabitCollection, HabitWithHistory } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-habits-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variant under test never calls it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let habitsRepo: typeof import('./repo').habitsRepo;
let isHabitCollection: typeof import('./repo').isHabitCollection;
let userStorage: typeof import('../storage/user-storage');

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ habitsRepo, isHabitCollection } = await import('./repo'));
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

describe('isHabitCollection', () => {
  it('accepts an empty collection', () => {
    expect(isHabitCollection({ habits: [] })).toBe(true);
  });

  it('accepts a populated collection', () => {
    expect(isHabitCollection({ habits: [{ id: 'h1' }] })).toBe(true);
  });

  it('rejects non-objects and missing/non-array habits', () => {
    expect(isHabitCollection(null)).toBe(false);
    expect(isHabitCollection({})).toBe(false);
    expect(isHabitCollection({ habits: 'nope' })).toBe(false);
  });
});

describe('habitsRepo metadata', () => {
  it('exposes the singleton filename, default, and guard the route reuses', () => {
    expect(habitsRepo.filename).toBe('habits.json');
    expect(habitsRepo.defaultValue).toEqual({ habits: [] });
    expect(habitsRepo.guard).toBe(isHabitCollection);
  });
});

describe('habitsRepo round-trip', () => {
  it('returns the empty default for a user with no stored collection', async () => {
    expect(await habitsRepo.read('habits-empty-user')).toEqual({ habits: [] });
  });

  it('persists and reads back a collection without stamping', async () => {
    const collection = { habits: [{ id: 'h1' } as unknown as HabitWithHistory] } as HabitCollection;
    const written = await habitsRepo.write('habits-rt-user', collection);
    expect(written).toBe(collection);

    const read = await habitsRepo.read('habits-rt-user');
    expect(read).toEqual(collection);
  });
});

describe('habits storage route parity', () => {
  it('persists a client body verbatim through the *ForUser write the route uses', async () => {
    const clientBody = { habits: [{ id: 'route-habit' } as unknown as HabitWithHistory] } as HabitCollection;

    await userStorage.writeUserStorageForUser<HabitCollection>(
      'habits-route-user',
      habitsRepo.filename,
      clientBody,
      habitsRepo.guard,
    );

    const read = await habitsRepo.read('habits-route-user');
    expect(read).toEqual(clientBody);
  });
});
