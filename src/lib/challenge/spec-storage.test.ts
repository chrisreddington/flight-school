/**
 * @vitest-environment node
 *
 * Unit tests for the per-user challenge spec store. The fixture writes
 * to a temp dir via `FLIGHT_SCHOOL_DATA_DIR` so we exercise the real
 * `fs.readFile` / `fs.writeFile` plumbing without touching the user's
 * home directory.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyChallenge } from '@/lib/focus/base-types';

const FIXTURE_USER_ID = '12345';

function makeSpec(id: string, overrides: Partial<DailyChallenge> = {}): DailyChallenge {
  return {
    id,
    title: 'Test Challenge',
    description: 'Do the thing',
    difficulty: 'beginner',
    language: 'TypeScript',
    estimatedTime: '30 minutes',
    whyThisChallenge: ['Practice makes perfect'],
    ...overrides,
  };
}

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(async () => ({
    userId: FIXTURE_USER_ID,
    login: 'tester',
    accessToken: 'gho_test',
  })),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

describe('challenge spec-storage', () => {
  let dataDir: string;
  let mod: typeof import('./spec-storage');

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'flight-school-spec-'));
    process.env.FLIGHT_SCHOOL_DATA_DIR = dataDir;
    // Re-import so the storage util captures the new data dir.
    vi.resetModules();
    mod = await import('./spec-storage');
  });

  afterEach(async () => {
    delete process.env.FLIGHT_SCHOOL_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  it('returns null when the spec has never been written', async () => {
    expect(await mod.readUserChallengeSpec('never-written')).toBeNull();
  });

  it('round-trips a written spec by id', async () => {
    const spec = makeSpec('round-trip', { title: 'Round trip' });
    await mod.writeUserChallengeSpec('round-trip', spec);
    const read = await mod.readUserChallengeSpec('round-trip');
    expect(read).toEqual(spec);
  });

  it('throws InvalidChallengeIdError when the id contains path-traversal characters', async () => {
    await expect(mod.readUserChallengeSpec('../escape')).rejects.toBeInstanceOf(mod.InvalidChallengeIdError);
    await expect(mod.writeUserChallengeSpec('../escape', makeSpec('x'))).rejects.toBeInstanceOf(
      mod.InvalidChallengeIdError,
    );
  });

  it('returns null (not throws) when the on-disk payload fails the shape check', async () => {
    // Plant a malformed file directly using the same low-level helper the
    // module uses, so we exercise the schema-guard branch.
    const { writeFile } = await import('@/lib/storage/utils');
    await writeFile(`users/${FIXTURE_USER_ID}/challenges`, 'malformed.json', '{"id":42}');
    expect(await mod.readUserChallengeSpec('malformed')).toBeNull();
  });

  it("partitions specs per user: a different userId cannot read another user's spec", async () => {
    const spec = makeSpec('private', { title: 'Mine' });
    await mod.writeUserChallengeSpec('private', spec);

    // Re-mock requireUserContext to return a different user, then re-import.
    vi.doMock('@/lib/auth/context', () => ({
      requireUserContext: vi.fn(async () => ({
        userId: '99999',
        login: 'intruder',
        accessToken: 'gho_other',
      })),
      UnauthorizedError: class UnauthorizedError extends Error {},
    }));
    vi.resetModules();
    const otherMod = await import('./spec-storage');
    expect(await otherMod.readUserChallengeSpec('private')).toBeNull();
  });
});
