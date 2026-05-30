/**
 * Tests for the custom-challenge-queue singleton repository.
 *
 * The generic singleton guarantees (construction throw, tenancy, legacy
 * read-through, …) are covered by
 * {@link import('../storage/document-store/singleton-repo.test')}. This suite
 * pins the queue-specific contract:
 *
 * - **Schema guard**: {@link isCustomChallengeQueue} is the single source of
 *   truth for the persisted shape; it validates the envelope AND every
 *   challenge's fields, so a malformed entry rejects the whole document.
 * - **No write-time stamp**: callers own `lastUpdated`, so a round-tripped body
 *   survives verbatim — the storage route and the challenge-edit Server Actions
 *   persist the same bytes through the same `filename`/`guard`.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module challenge/queue-repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomChallengeQueue } from './queue-repo';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-challenge-queue-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variant under test never calls it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let challengeQueueRepo: typeof import('./queue-repo').challengeQueueRepo;
let isCustomChallengeQueue: typeof import('./queue-repo').isCustomChallengeQueue;
let userStorage: typeof import('../storage/user-storage');

const VALID_CHALLENGE = {
  id: 'c1',
  title: 'Reverse a string',
  description: 'Return the input reversed.',
  language: 'typescript',
  difficulty: 'beginner',
};

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ challengeQueueRepo, isCustomChallengeQueue } = await import('./queue-repo'));
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

describe('isCustomChallengeQueue', () => {
  it('accepts an empty queue', () => {
    expect(isCustomChallengeQueue({ challenges: [], lastUpdated: '' })).toBe(true);
  });

  it('accepts a queue of well-formed challenges', () => {
    expect(isCustomChallengeQueue({ challenges: [VALID_CHALLENGE], lastUpdated: '2026-05-31' })).toBe(true);
  });

  it('rejects non-objects and a missing/non-string envelope', () => {
    expect(isCustomChallengeQueue(null)).toBe(false);
    expect(isCustomChallengeQueue({})).toBe(false);
    expect(isCustomChallengeQueue({ challenges: 'nope', lastUpdated: '' })).toBe(false);
    expect(isCustomChallengeQueue({ challenges: [], lastUpdated: 7 })).toBe(false);
  });

  it('rejects a challenge missing required fields or with an unknown difficulty', () => {
    expect(isCustomChallengeQueue({ challenges: [{ ...VALID_CHALLENGE, id: undefined }], lastUpdated: '' })).toBe(
      false,
    );
    expect(
      isCustomChallengeQueue({ challenges: [{ ...VALID_CHALLENGE, difficulty: 'expert' }], lastUpdated: '' }),
    ).toBe(false);
  });
});

describe('challengeQueueRepo metadata', () => {
  it('exposes the singleton filename, default, and guard the route reuses', () => {
    expect(challengeQueueRepo.filename).toBe('challenge-queue.json');
    expect(challengeQueueRepo.defaultValue).toEqual({ challenges: [], lastUpdated: '' });
    expect(challengeQueueRepo.guard).toBe(isCustomChallengeQueue);
  });
});

describe('challengeQueueRepo round-trip', () => {
  it('returns the empty default for a user with no stored queue', async () => {
    expect(await challengeQueueRepo.read('queue-empty-user')).toEqual({ challenges: [], lastUpdated: '' });
  });

  it('persists and reads back a queue without stamping', async () => {
    const queue = { challenges: [VALID_CHALLENGE], lastUpdated: '2026-05-31' } as unknown as CustomChallengeQueue;
    const written = await challengeQueueRepo.write('queue-rt-user', queue);
    expect(written).toBe(queue);

    const read = await challengeQueueRepo.read('queue-rt-user');
    expect(read).toEqual(queue);
  });
});

describe('challenge queue storage route parity', () => {
  it('persists a client body verbatim through the *ForUser write the route uses', async () => {
    const clientBody = {
      challenges: [{ ...VALID_CHALLENGE, id: 'c2' }],
      lastUpdated: '2026-06-01',
    } as unknown as CustomChallengeQueue;

    await userStorage.writeUserStorageForUser<CustomChallengeQueue>(
      'queue-route-user',
      challengeQueueRepo.filename,
      clientBody,
      challengeQueueRepo.guard,
    );

    const read = await challengeQueueRepo.read('queue-route-user');
    expect(read).toEqual(clientBody);
  });
});
