import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchJobExecution } from './dispatcher';

const mocks = vi.hoisted(() => ({
  executeTopicRegeneration: vi.fn(),
  executeChallengeRegeneration: vi.fn(),
  executeGoalRegeneration: vi.fn(),
  executeChatResponse: vi.fn(),
  executeChallengeEvaluation: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: vi.fn(() => ({
      error: mocks.logError,
    })),
  },
}));

vi.mock('./job-executors', () => ({
  executeTopicRegeneration: mocks.executeTopicRegeneration,
  executeChallengeRegeneration: mocks.executeChallengeRegeneration,
  executeGoalRegeneration: mocks.executeGoalRegeneration,
  executeChatResponse: mocks.executeChatResponse,
  executeChallengeEvaluation: mocks.executeChallengeEvaluation,
}));

describe('dispatchJobExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeTopicRegeneration.mockResolvedValue(undefined);
  });

  it('dispatches token-free job payloads by type', async () => {
    await dispatchJobExecution({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { existingTopicTitles: [], skillProfile: undefined },
      userId: '123',
    });

    expect(mocks.executeTopicRegeneration).toHaveBeenCalledWith(
      'job-1',
      { existingTopicTitles: [], skillProfile: undefined },
      '123',
    );
  });

  it('logs and resolves executor failures to preserve fire-and-forget behavior', async () => {
    const error = new Error('executor failed');
    mocks.executeTopicRegeneration.mockRejectedValue(error);

    await expect(dispatchJobExecution({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { existingTopicTitles: [] },
      userId: '123',
    })).resolves.toBeUndefined();

    expect(mocks.logError).toHaveBeenCalledWith('Unhandled error in job job-1:', error);
  });
});
