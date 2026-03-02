import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LearningHistory } from './index';

const { getHistoryMock, loadHabitsMock, loggerErrorMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  loadHabitsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  usePathname: () => '/history',
}));

vi.mock('@/hooks/use-active-operations', () => ({
  useActiveOperations: () => ({
    activeTopicIds: new Set<string>(),
    activeChallengeIds: new Set<string>(),
    activeGoalIds: new Set<string>(),
  }),
}));

vi.mock('@/hooks/use-ai-focus', () => ({
  useAIFocus: () => ({
    skipAndReplaceTopic: vi.fn(),
    skipAndReplaceChallenge: vi.fn(),
    skipAndReplaceGoal: vi.fn(),
    skippingTopicIds: new Set<string>(),
    skippingChallengeIds: new Set<string>(),
    skippingGoalIds: new Set<string>(),
    stopTopicSkip: vi.fn(),
    stopChallengeSkip: vi.fn(),
    stopGoalSkip: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-learning-chat', () => ({
  useLearningChat: () => ({
    createThread: vi.fn(),
    sendMessage: vi.fn(),
  }),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    getHistory: getHistoryMock,
  },
}));

vi.mock('@/lib/habits', () => ({
  habitStore: {
    load: loadHabitsMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

describe('LearningHistory load errors', () => {
  it('shows an error banner when history loading fails', async () => {
    getHistoryMock.mockRejectedValueOnce(new Error('storage failed'));
    loadHabitsMock.mockResolvedValueOnce({ habits: [] });

    render(<LearningHistory />);

    expect(await screen.findAllByText(/Failed to load/i)).not.toHaveLength(0);
  });
});
