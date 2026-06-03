import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearningHistory } from './index';

const { getHistoryMock, loadHabitsMock, loggerErrorMock, replaceMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  loadHabitsMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
  }),
  usePathname: () => '/history',
}));

vi.mock('@/app/habits/actions', () => ({
  updateHabitAction: vi.fn().mockResolvedValue({ ok: true }),
  createHabitAction: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('@/app/challenge/actions', () => ({
  updateChallengeAction: vi.fn().mockResolvedValue({ ok: true }),
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

describe('LearningHistory page shell', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    getHistoryMock.mockResolvedValue([]);
    loadHabitsMock.mockResolvedValue({ habits: [] });
  });

  it('renders exactly one h1 titled "Learning History"', async () => {
    render(<LearningHistory />);

    const headings = await screen.findAllByRole('heading', { level: 1, name: 'Learning History' });
    expect(headings).toHaveLength(1);
  });

  it('navigates to the stats tab when the Stats tab is selected', async () => {
    render(<LearningHistory activeTab="history" />);

    // Wait for data loading to settle so the tab nodes are stable before we click.
    await screen.findByRole('heading', { level: 1, name: 'Learning History' });

    await waitFor(() => {
      fireEvent.click(screen.getByRole('tab', { name: /stats/i }));
      expect(replaceMock).toHaveBeenCalledWith('/history?tab=stats');
    });
  });
});
