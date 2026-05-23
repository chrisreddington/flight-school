import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dispatchJobExecution } from './dispatcher';

const mocks = vi.hoisted(() => ({
  dispatchJobExecutionToWorker: vi.fn(),
  markFailed: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('./worker-client', () => ({
  dispatchJobExecutionToWorker: mocks.dispatchJobExecutionToWorker,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    markFailed: mocks.markFailed,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      error: mocks.logError,
    })),
  },
}));

describe('dispatchJobExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches jobs through the worker client', async () => {
    mocks.dispatchJobExecutionToWorker.mockResolvedValue(undefined);

    await dispatchJobExecution({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { existingTopicTitles: [], skillProfile: undefined },
      userId: 'user-1',
    });

    expect(mocks.dispatchJobExecutionToWorker).toHaveBeenCalledWith({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { existingTopicTitles: [], skillProfile: undefined },
      userId: 'user-1',
    });
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('marks the job failed when worker dispatch throws', async () => {
    const error = new Error('worker unavailable');
    mocks.dispatchJobExecutionToWorker.mockRejectedValue(error);

    await expect(
      dispatchJobExecution({
        jobId: 'job-1',
        type: 'topic-regeneration',
        input: { existingTopicTitles: [] },
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.logError).toHaveBeenCalledWith('[Job job-1] Failed to dispatch to worker', error);
    expect(mocks.markFailed).toHaveBeenCalledWith('job-1', 'Worker dispatch failed', 'unknown');
  });
});
