/**
 * Tests for the skills-profile singleton repository — the pattern-setter for
 * every domain repo.
 *
 * Beyond the generic guarantees covered by
 * {@link import('../storage/document-store/singleton-repo.test')}, the skills
 * repo carries two domain specifics worth pinning:
 *
 * - **Write-time stamp**: {@link skillsRepo.write} sets `lastUpdated` to the
 *   current time so Server Actions don't thread a timestamp through. The
 *   storage route, by contrast, persists the client's already-stamped body
 *   verbatim (it reuses `filename`/`defaultValue`/`guard` with the stampless
 *   factory write), so a round-tripped POST is NOT re-stamped — this test pins
 *   that the two write paths differ ONLY by the stamp (rubber-duck finding #2).
 * - **Schema guard**: {@link isSkillProfile} is the single source of truth for
 *   the persisted shape; a few accept/reject cases pin its contract.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load,
 * so modules are dynamic-imported after the env stub) with the tombstone and
 * clock seams mocked.
 *
 * @module skills/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillProfile, UserSkill } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-skills-repo-${Date.now()}`);
const FIXED_NOW = '2026-06-01T00:00:00.000Z';

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);
const nowMock = vi.fn((): string => FIXED_NOW);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `user-storage` imports `requireUserContext`, which pulls in next-auth at load.
// The `*ForUser` variant under test never calls it, so a bare stub is enough.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

vi.mock('@/lib/utils/date-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/date-utils')>();
  return { ...actual, now: () => nowMock() };
});

const SAMPLE_SKILL: UserSkill = { skillId: 'typescript', level: 'intermediate', source: 'github' };

let skillsRepo: typeof import('./repo').skillsRepo;
let isSkillProfile: typeof import('./repo').isSkillProfile;
let userStorage: typeof import('../storage/user-storage');

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ skillsRepo, isSkillProfile } = await import('./repo'));
  userStorage = await import('../storage/user-storage');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
  nowMock.mockReset();
  nowMock.mockReturnValue(FIXED_NOW);
});

describe('isSkillProfile', () => {
  it('accepts a well-formed profile', () => {
    const profile: SkillProfile = { skills: [SAMPLE_SKILL], lastUpdated: FIXED_NOW };
    expect(isSkillProfile(profile)).toBe(true);
  });

  it('accepts the empty default profile', () => {
    expect(isSkillProfile({ skills: [], lastUpdated: '' })).toBe(true);
  });

  it('rejects non-objects and missing fields', () => {
    expect(isSkillProfile(null)).toBe(false);
    expect(isSkillProfile({ skills: [] })).toBe(false);
    expect(isSkillProfile({ lastUpdated: '' })).toBe(false);
    expect(isSkillProfile({ skills: 'nope', lastUpdated: '' })).toBe(false);
  });

  it('rejects skills with an invalid level or source', () => {
    expect(isSkillProfile({ skills: [{ skillId: 'x', level: 'expert', source: 'github' }], lastUpdated: '' })).toBe(
      false,
    );
    expect(isSkillProfile({ skills: [{ skillId: 'x', level: 'beginner', source: 'guessed' }], lastUpdated: '' })).toBe(
      false,
    );
  });
});

describe('skillsRepo metadata', () => {
  it('exposes the singleton filename, default, and guard the route reuses', () => {
    expect(skillsRepo.filename).toBe('skills-profile.json');
    expect(skillsRepo.defaultValue).toEqual({ skills: [], lastUpdated: '' });
    expect(skillsRepo.guard).toBe(isSkillProfile);
  });
});

describe('skillsRepo write-time stamp', () => {
  it('stamps lastUpdated with the current time, ignoring the client-supplied value', async () => {
    const written = await skillsRepo.write('skills-stamp-user', {
      skills: [SAMPLE_SKILL],
      lastUpdated: 'client-claimed-stale',
    });
    expect(written.lastUpdated).toBe(FIXED_NOW);
    expect(written.skills).toEqual([SAMPLE_SKILL]);

    const read = await skillsRepo.read('skills-stamp-user');
    expect(read.lastUpdated).toBe(FIXED_NOW);
  });

  it('returns the empty default for a user with no stored profile', async () => {
    expect(await skillsRepo.read('skills-empty-user')).toEqual({ skills: [], lastUpdated: '' });
  });
});

describe('skills storage route parity (no re-stamp)', () => {
  it('persists a client body verbatim through the stampless *ForUser write the route uses', async () => {
    const clientBody: SkillProfile = { skills: [SAMPLE_SKILL], lastUpdated: '2025-12-31T12:00:00.000Z' };

    // The route persists via writeUserStorageForUser (no stamp), reusing the
    // repo's filename/guard — so the client's timestamp survives untouched.
    await userStorage.writeUserStorageForUser<SkillProfile>(
      'skills-route-user',
      skillsRepo.filename,
      clientBody,
      skillsRepo.guard,
    );

    const read = await skillsRepo.read('skills-route-user');
    expect(read.lastUpdated).toBe('2025-12-31T12:00:00.000Z');
    expect(nowMock).not.toHaveBeenCalled();
  });
});
