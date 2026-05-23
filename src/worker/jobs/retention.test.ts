/**
 * Focused tests for the worker-side job-record retention sweepers.
 *
 * The per-user file sweeps still live in
 * `src/lib/storage/retention.test.ts` (back-compat barrel). These
 * tests cover the three job sweeps directly via a mocked
 * `jobStorage`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '@/lib/jobs/storage';

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  markFailed: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    getAll: mocks.getAll,
    markFailed: mocks.markFailed,
    delete: mocks.delete,
    update: mocks.update,
  },
}));

import { redactTerminalJobs, sweepOrphanJobs, sweepStaleRunningJobs } from './retention';

function makeJob(overrides: Partial<BackgroundJob>): BackgroundJob {
  return {
    id: 'job-1',
    type: 'chat-response',
    userId: 'u-1',
    status: 'pending',
    input: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  } as BackgroundJob;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sweepStaleRunningJobs', () => {
  it('marks running jobs older than the TTL as failed', async () => {
    const now = Date.UTC(2024, 0, 10);
    mocks.getAll.mockResolvedValue([
      makeJob({ id: 'fresh', status: 'running', startedAt: new Date(now - 500).toISOString() }),
      makeJob({ id: 'stale', status: 'running', startedAt: new Date(now - 5000).toISOString() }),
    ]);

    const result = await sweepStaleRunningJobs(now, 1000);

    expect(result).toEqual({ deleted: 1, inspected: 2, sweptIds: ['stale'] });
    expect(mocks.markFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markFailed).toHaveBeenCalledWith(
      'stale',
      expect.stringContaining('stale-running TTL'),
      'unknown',
    );
  });

  it('falls back to createdAt for pending jobs', async () => {
    const now = Date.UTC(2024, 0, 10);
    mocks.getAll.mockResolvedValue([
      makeJob({ id: 'stale-pending', status: 'pending', createdAt: new Date(now - 5000).toISOString() }),
    ]);

    const result = await sweepStaleRunningJobs(now, 1000);

    expect(result.deleted).toBe(1);
    expect(mocks.markFailed).toHaveBeenCalledWith('stale-pending', expect.any(String), 'unknown');
  });

  it('ignores terminal jobs', async () => {
    mocks.getAll.mockResolvedValue([
      makeJob({ id: 'done', status: 'completed' }),
      makeJob({ id: 'gone', status: 'failed' }),
    ]);

    const result = await sweepStaleRunningJobs(Date.now(), 1);

    expect(result.deleted).toBe(0);
    expect(result.inspected).toBe(0);
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });
});

describe('sweepOrphanJobs', () => {
  it('deletes jobs without a userId', async () => {
    mocks.getAll.mockResolvedValue([
      makeJob({ id: 'orphan', userId: '' as unknown as string }),
      makeJob({ id: 'owned' }),
    ]);

    const result = await sweepOrphanJobs();

    expect(result).toEqual({ deleted: 1, inspected: 2 });
    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(mocks.delete).toHaveBeenCalledWith('orphan');
  });

  it('is a no-op when every job has an owner', async () => {
    mocks.getAll.mockResolvedValue([makeJob({ id: 'owned' })]);

    const result = await sweepOrphanJobs();

    expect(result).toEqual({ deleted: 0, inspected: 1 });
    expect(mocks.delete).not.toHaveBeenCalled();
  });
});

describe('redactTerminalJobs', () => {
  it('redacts prompt + result on terminal jobs', async () => {
    mocks.getAll.mockResolvedValue([
      makeJob({
        id: 'done',
        status: 'completed',
        input: { prompt: 'secret prompt' },
        result: { reply: 'secret reply' },
      }),
    ]);

    const result = await redactTerminalJobs();

    expect(result.deleted).toBe(1);
    expect(mocks.update).toHaveBeenCalledWith(
      'done',
      expect.objectContaining({
        input: expect.objectContaining({ prompt: '[redacted]' }),
        result: expect.objectContaining({ __redacted: true }),
      }),
    );
  });

  it('skips already-redacted jobs', async () => {
    mocks.getAll.mockResolvedValue([
      makeJob({
        id: 'already',
        status: 'completed',
        input: { prompt: '[redacted]' },
        result: { __redacted: true, redactedAt: '2024-01-01T00:00:00.000Z' },
      }),
    ]);

    const result = await redactTerminalJobs();

    expect(result.deleted).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('skips non-terminal jobs', async () => {
    mocks.getAll.mockResolvedValue([
      makeJob({ id: 'pending', status: 'pending', input: { prompt: 'x' } }),
      makeJob({ id: 'running', status: 'running', input: { prompt: 'y' } }),
    ]);

    const result = await redactTerminalJobs();

    expect(result.deleted).toBe(0);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
