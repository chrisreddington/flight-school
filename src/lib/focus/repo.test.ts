/**
 * Tests for the focus-storage singleton repository.
 *
 * The generic singleton guarantees (construction throw, tenancy, legacy
 * read-through, …) are covered by
 * {@link import('../storage/document-store/singleton-repo.test')}. This suite
 * pins the focus-specific contract:
 *
 * - **Schema guard**: {@link isFocusStorageSchema} is the single source of
 *   truth for the persisted shape; a few accept/reject cases pin its contract.
 * - **No write-time stamp**: the schema carries no server-stamped field, so a
 *   round-tripped body survives verbatim — the storage route persists the same
 *   bytes through the same `filename`/`guard`.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module focus/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusStorageSchema } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-focus-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variant under test never calls it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let focusRepo: typeof import('./repo').focusRepo;
let isFocusStorageSchema: typeof import('./repo').isFocusStorageSchema;
let userStorage: typeof import('../storage/user-storage');

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ focusRepo, isFocusStorageSchema } = await import('./repo'));
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

describe('isFocusStorageSchema', () => {
  it('accepts an empty history', () => {
    expect(isFocusStorageSchema({ history: {} })).toBe(true);
  });

  it('accepts a populated history', () => {
    expect(isFocusStorageSchema({ history: { '2026-05-30': {} } })).toBe(true);
  });

  it('rejects non-objects and missing/non-object history', () => {
    expect(isFocusStorageSchema(null)).toBe(false);
    expect(isFocusStorageSchema({})).toBe(false);
    expect(isFocusStorageSchema({ history: null })).toBe(false);
    expect(isFocusStorageSchema({ history: 'nope' })).toBe(false);
  });
});

describe('focusRepo metadata', () => {
  it('exposes the singleton filename, default, and guard the route reuses', () => {
    expect(focusRepo.filename).toBe('focus-storage.json');
    expect(focusRepo.defaultValue).toEqual({ history: {} });
    expect(focusRepo.guard).toBe(isFocusStorageSchema);
  });
});

describe('focusRepo round-trip', () => {
  it('returns the empty default for a user with no stored history', async () => {
    expect(await focusRepo.read('focus-empty-user')).toEqual({ history: {} });
  });

  it('persists and reads back a schema without stamping', async () => {
    const schema = { history: { '2026-05-30': {} } } as unknown as FocusStorageSchema;
    const written = await focusRepo.write('focus-rt-user', schema);
    expect(written).toBe(schema);

    const read = await focusRepo.read('focus-rt-user');
    expect(read).toEqual(schema);
  });
});

describe('focus storage route parity', () => {
  it('persists a client body verbatim through the *ForUser write the route uses', async () => {
    const clientBody = { history: { '2026-05-31': {} } } as unknown as FocusStorageSchema;

    await userStorage.writeUserStorageForUser<FocusStorageSchema>(
      'focus-route-user',
      focusRepo.filename,
      clientBody,
      focusRepo.guard,
    );

    const read = await focusRepo.read('focus-route-user');
    expect(read).toEqual(clientBody);
  });
});
