/**
 * Behaviour contract for the per-user retention sweeper after threads and
 * evaluations moved onto the envelope {@link DocumentStore}.
 *
 * Verifies the sweep enumerates users via the registry (populated by envelope
 * writes), prunes stale threads and terminal-and-old evaluations, keeps fresh
 * and non-terminal entries, and aggregates per-store counts. Exercises the REAL
 * store over a temp data dir; only the tombstone seam is mocked.
 *
 * @module storage/user-retention.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Thread } from '@/lib/threads';
import type { EvaluationProgress } from '@/lib/jobs/storage/evaluation-storage';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-user-retention-${Date.now()}`);

vi.mock('@/lib/storage/tombstone', () => ({
  isUserDeleted: async () => false,
}));

const NOW_MS = Date.parse('2026-06-01T00:00:00.000Z');
const STALE_ISO = '2026-01-01T00:00:00.000Z';
const FRESH_ISO = '2026-05-31T18:00:00.000Z';

let retention: typeof import('./user-retention');
let threadsStore: typeof import('@/lib/jobs/storage/threads-storage');
let evaluationStore: typeof import('@/lib/jobs/storage/evaluation-storage');

function makeThread(id: string, updatedAt: string): Thread {
  return {
    id,
    title: id,
    context: {} as Thread['context'],
    messages: [],
    createdAt: STALE_ISO,
    updatedAt,
  };
}

function makeEvaluation(
  challengeId: string,
  status: EvaluationProgress['status'],
  updatedAt: string,
): EvaluationProgress {
  return { challengeId, jobId: `job-${challengeId}`, status, streamingFeedback: '', updatedAt };
}

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  retention = await import('./user-retention');
  threadsStore = await import('@/lib/jobs/storage/threads-storage');
  evaluationStore = await import('@/lib/jobs/storage/evaluation-storage');

  await threadsStore.writeThreadsStorage('ret-user-a', [
    makeThread('t-old', STALE_ISO),
    makeThread('t-new', FRESH_ISO),
  ]);
  await threadsStore.writeThreadsStorage('ret-user-b', [makeThread('b-new', FRESH_ISO)]);

  await evaluationStore.writeEvaluationStorage('ret-user-a', {
    evaluations: {
      'e-old': makeEvaluation('e-old', 'completed', STALE_ISO),
      'e-recent': makeEvaluation('e-recent', 'completed', FRESH_ISO),
      'e-stream': makeEvaluation('e-stream', 'streaming', STALE_ISO),
    },
    version: 1,
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

describe('sweepAllUsers', () => {
  it('prunes stale entries, keeps fresh and non-terminal ones, and aggregates per store', async () => {
    const aggregate = await retention.sweepAllUsers(NOW_MS);

    expect(aggregate.threads).toEqual({ deleted: 1, inspected: 3 });
    expect(aggregate.evaluations).toEqual({ deleted: 1, inspected: 3 });

    // User A keeps only its fresh thread; user B is untouched.
    expect((await threadsStore.readThreadsStorage('ret-user-a')).map((t) => t.id)).toEqual(['t-new']);
    expect((await threadsStore.readThreadsStorage('ret-user-b')).map((t) => t.id)).toEqual(['b-new']);

    // Only the stale terminal evaluation is dropped; the recent terminal and
    // the non-terminal streaming entry survive.
    const stored = await evaluationStore.readEvaluationStorage('ret-user-a');
    expect(Object.keys(stored.evaluations).sort()).toEqual(['e-recent', 'e-stream']);
  });
});
