import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeWorkerJob } from './executor-dispatcher';

const mocks = vi.hoisted(() => ({
  executeTopicRegeneration: vi.fn(),
  executeChallengeRegeneration: vi.fn(),
  executeGoalRegeneration: vi.fn(),
  executeChatResponse: vi.fn(),
  executeChallengeEvaluation: vi.fn(),
}));

vi.mock('./executors/regeneration', () => ({
  executeTopicRegeneration: mocks.executeTopicRegeneration,
  executeChallengeRegeneration: mocks.executeChallengeRegeneration,
  executeGoalRegeneration: mocks.executeGoalRegeneration,
}));

vi.mock('./executors/chat', () => ({
  executeChatResponse: mocks.executeChatResponse,
}));

vi.mock('./executors/evaluation', () => ({
  executeChallengeEvaluation: mocks.executeChallengeEvaluation,
}));

describe('executeWorkerJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes topic regeneration jobs', async () => {
    await executeWorkerJob({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { existingTopicTitles: [], skillProfile: undefined },
      userId: 'user-1',
    });

    expect(mocks.executeTopicRegeneration).toHaveBeenCalledWith(
      'job-1',
      { existingTopicTitles: [], skillProfile: undefined },
      'user-1',
    );
  });

  it('routes challenge evaluation jobs', async () => {
    await executeWorkerJob({
      jobId: 'job-2',
      type: 'challenge-evaluation',
      input: { challengeId: 'challenge-1', challenge: {} as never, files: [] },
      userId: 'user-2',
    });

    expect(mocks.executeChallengeEvaluation).toHaveBeenCalledWith(
      'job-2',
      { challengeId: 'challenge-1', challenge: {}, files: [] },
      'user-2',
    );
  });
});
