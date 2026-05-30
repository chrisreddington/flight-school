/**
 * Tests for the Next-free per-user store resolver.
 *
 * The resolver's job is narrow but load-bearing: bind the process-wide
 * {@link DocumentStore} to one `userId` as the partition key and inject the
 * tombstone seam. These tests prove the partitioning isolates users and that a
 * set tombstone blocks writes — using the real file adapter against a temp dir,
 * with only the tombstone seam mocked so it can be flipped.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-scoped-store-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

let getUserScopedStoreForUser: typeof import('./scoped-store').getUserScopedStoreForUser;

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ getUserScopedStoreForUser } = await import('./scoped-store'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

describe('getUserScopedStoreForUser', () => {
  it('round-trips a document scoped to the resolved user', async () => {
    const store = await getUserScopedStoreForUser('user-round-trip');
    await store.put('skills', 'current', { level: 'beginner' });
    const read = await store.get<{ level: string }>('skills', 'current');
    expect(read).toEqual({ level: 'beginner' });
  });

  it('isolates documents between two users sharing a container and id', async () => {
    const alice = await getUserScopedStoreForUser('user-alice');
    const bob = await getUserScopedStoreForUser('user-bob');
    await alice.put('skills', 'current', { owner: 'alice' });

    const bobView = await bob.get<{ owner: string }>('skills', 'current');
    expect(bobView).toBeNull();
  });

  it('rejects writes once the user tombstone is set', async () => {
    isUserDeletedMock.mockResolvedValueOnce(true);
    const store = await getUserScopedStoreForUser('user-deleted');
    await expect(store.put('skills', 'current', { level: 'x' })).rejects.toThrow();
  });
});
