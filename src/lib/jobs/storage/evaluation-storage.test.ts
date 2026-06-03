/**
 * Behaviour contract for the per-user evaluation store after it moved onto the
 * envelope {@link import('@/lib/storage/document-store/singleton-repo')} via the
 * `'evaluations'` container mapping.
 *
 * Exercises the REAL document store over a temp data dir (env resolved at module
 * load, so the module under test is dynamic-imported AFTER the env stub —
 * mirroring `singleton-repo.test.ts`). Only the deletion-tombstone seam is
 * mocked, so the envelope round-trip, schema healing, and tenancy partitioning
 * are all real.
 *
 * @module jobs/storage/evaluation-storage.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvaluationProgress } from './evaluation-storage';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-evaluation-storage-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('@/lib/storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

type EvaluationModule = typeof import('./evaluation-storage');
let mod: EvaluationModule;

function makeProgress(overrides: Partial<EvaluationProgress> = {}): EvaluationProgress {
  return {
    challengeId: 'chal-1',
    jobId: 'job-1',
    status: 'completed' as const,
    streamingFeedback: 'looks good',
    updatedAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  mod = await import('./evaluation-storage');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('evaluation-storage envelope round-trip', () => {
  it('returns the default schema when nothing is stored', async () => {
    const stored = await mod.readEvaluationStorage('eval-user-empty');
    expect(stored).toEqual({ evaluations: {}, version: 1 });
  });

  it('persists a written schema and reads it back', async () => {
    const progress = makeProgress();
    await mod.writeEvaluationStorage('eval-user-rt', {
      evaluations: { 'chal-1': progress },
      version: 1,
    });

    const stored = await mod.readEvaluationStorage('eval-user-rt');
    expect(stored.evaluations['chal-1']).toEqual(progress);
    expect(stored.version).toBe(1);
  });

  it('getEvaluationProgress returns the entry by challenge id, null when absent', async () => {
    const progress = makeProgress({ challengeId: 'chal-x', jobId: 'job-x' });
    await mod.writeEvaluationStorage('eval-user-get', {
      evaluations: { 'chal-x': progress },
      version: 1,
    });

    expect(await mod.getEvaluationProgress('eval-user-get', 'chal-x')).toEqual(progress);
    expect(await mod.getEvaluationProgress('eval-user-get', 'missing')).toBeNull();
  });

  it('clearEvaluationProgress deletes one entry and keeps the others', async () => {
    await mod.writeEvaluationStorage('eval-user-clear', {
      evaluations: {
        keep: makeProgress({ challengeId: 'keep', jobId: 'job-keep' }),
        drop: makeProgress({ challengeId: 'drop', jobId: 'job-drop' }),
      },
      version: 1,
    });

    await mod.clearEvaluationProgress('eval-user-clear', 'drop');

    const stored = await mod.readEvaluationStorage('eval-user-clear');
    expect(Object.keys(stored.evaluations)).toEqual(['keep']);
  });
});

describe('evaluation-storage tenancy + tombstone', () => {
  it('keeps two users their own evaluations', async () => {
    await mod.writeEvaluationStorage('eval-user-a', {
      evaluations: { 'chal-a': makeProgress({ challengeId: 'chal-a', jobId: 'job-a' }) },
      version: 1,
    });
    await mod.writeEvaluationStorage('eval-user-b', {
      evaluations: { 'chal-b': makeProgress({ challengeId: 'chal-b', jobId: 'job-b' }) },
      version: 1,
    });

    const a = await mod.readEvaluationStorage('eval-user-a');
    const b = await mod.readEvaluationStorage('eval-user-b');
    expect(Object.keys(a.evaluations)).toEqual(['chal-a']);
    expect(Object.keys(b.evaluations)).toEqual(['chal-b']);
  });

  it('silently aborts a write for a tombstoned user without throwing', async () => {
    isUserDeletedMock.mockResolvedValue(true);

    await expect(
      mod.writeEvaluationStorage('eval-user-deleted', {
        evaluations: { 'chal-1': makeProgress() },
        version: 1,
      }),
    ).resolves.toBeUndefined();

    isUserDeletedMock.mockResolvedValue(false);
    const stored = await mod.readEvaluationStorage('eval-user-deleted');
    expect(stored.evaluations).toEqual({});
  });
});
