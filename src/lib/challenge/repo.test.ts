/**
 * Tests for the by-id challenge-spec collection repository.
 *
 * Unlike the singleton repos (skills, habits, …) this is a COLLECTION keyed by
 * challenge id, and its reads are deliberately SIDE-EFFECT-FREE: a missing spec
 * returns `null` and never self-heals a default. This suite pins that
 * collection contract plus the read-through-migrating semantics:
 *
 * - Round-trip through the envelope store.
 * - Invalid id throws {@link InvalidChallengeIdError} on both read and write.
 * - Missing spec → `null` (no default written).
 * - Corrupt envelope body → `null` (no write-back).
 * - Healthy legacy file → returned AS-IS (no promotion to envelope).
 * - Corrupt legacy file → `null`.
 * - Cross-user isolation.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module challenge/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChallengeSpec } from './repo';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-challenge-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `repo` does not call `requireUserContext`, but its module graph pulls in
// next-auth at load through shared storage modules; a bare stub avoids that.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let challengeSpecRepo: typeof import('./repo').challengeSpecRepo;
let InvalidChallengeIdError: typeof import('./repo').InvalidChallengeIdError;
let getUserScopedStoreForUser: typeof import('../storage/document-store/scoped-store').getUserScopedStoreForUser;
let writeFile: typeof import('../storage/utils').writeFile;

function makeSpec(id: string, overrides: Partial<ChallengeSpec> = {}): ChallengeSpec {
  return {
    id,
    title: 'Reverse a string',
    description: 'Return the input reversed.',
    difficulty: 'beginner',
    language: 'TypeScript',
    estimatedTime: '30 minutes',
    whyThisChallenge: ['Practice makes perfect'],
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ challengeSpecRepo, InvalidChallengeIdError } = await import('./repo'));
  ({ getUserScopedStoreForUser } = await import('../storage/document-store/scoped-store'));
  ({ writeFile } = await import('../storage/utils'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('challengeSpecRepo round-trip', () => {
  it('persists and reads back a spec by id', async () => {
    const spec = makeSpec('round-trip', { title: 'Round trip' });
    await challengeSpecRepo.write('spec-rt-user', 'round-trip', spec);
    expect(await challengeSpecRepo.read('spec-rt-user', 'round-trip')).toEqual(spec);
  });
});

describe('challengeSpecRepo id validation', () => {
  it('throws InvalidChallengeIdError on read and write for a traversal id', async () => {
    await expect(challengeSpecRepo.read('spec-bad-user', '../escape')).rejects.toBeInstanceOf(InvalidChallengeIdError);
    await expect(challengeSpecRepo.write('spec-bad-user', '../escape', makeSpec('x'))).rejects.toBeInstanceOf(
      InvalidChallengeIdError,
    );
  });
});

describe('challengeSpecRepo side-effect-free reads', () => {
  it('returns null for a never-written spec and writes no default', async () => {
    expect(await challengeSpecRepo.read('spec-missing-user', 'never')).toBeNull();
    // A second read still sees null — the first read did not self-heal a default.
    const store = await getUserScopedStoreForUser('spec-missing-user');
    expect(await store.getEnvelope('challenges', 'never')).toBeNull();
  });

  it('returns null for a corrupt envelope body without writing it back', async () => {
    const store = await getUserScopedStoreForUser('spec-corrupt-user');
    await store.put('challenges', 'corrupt', { id: 42 } as unknown as ChallengeSpec);
    expect(await challengeSpecRepo.read('spec-corrupt-user', 'corrupt')).toBeNull();
    // The corrupt body is left intact (no self-heal write-back).
    const after = await store.getEnvelope<{ id: number }>('challenges', 'corrupt');
    expect(after?.body).toEqual({ id: 42 });
  });
});

describe('challengeSpecRepo legacy read-through', () => {
  it('returns a healthy legacy file AS-IS without promoting it to an envelope', async () => {
    const spec = makeSpec('legacy-ok', { title: 'Legacy' });
    await writeFile('users/spec-legacy-user/challenges', 'legacy-ok.json', JSON.stringify(spec));
    expect(await challengeSpecRepo.read('spec-legacy-user', 'legacy-ok')).toEqual(spec);
    // No envelope was written (the migrator is the only legacy→envelope promoter).
    const store = await getUserScopedStoreForUser('spec-legacy-user');
    expect(await store.getEnvelope('challenges', 'legacy-ok')).toBeNull();
  });

  it('returns null for a corrupt legacy file', async () => {
    await writeFile('users/spec-legacy-bad-user/challenges', 'broken.json', '{"id":42}');
    expect(await challengeSpecRepo.read('spec-legacy-bad-user', 'broken')).toBeNull();
  });
});

describe('challengeSpecRepo tenancy', () => {
  it("does not read another user's spec for the same id", async () => {
    const spec = makeSpec('shared', { title: 'Owner' });
    await challengeSpecRepo.write('spec-owner-user', 'shared', spec);
    expect(await challengeSpecRepo.read('spec-intruder-user', 'shared')).toBeNull();
  });
});
