import type { FocusResponse } from '@/lib/focus/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DailyFocusSection } from './daily-focus-section';

const {
  addChallengeMock,
  transitionChallengeMock,
  useCustomChallengeQueueMock,
  advanceQueueMock,
  getDateKeyMock,
  pushMock,
} = vi.hoisted(() => ({
  addChallengeMock: vi.fn(),
  transitionChallengeMock: vi.fn(),
  useCustomChallengeQueueMock: vi.fn(),
  advanceQueueMock: vi.fn(),
  getDateKeyMock: vi.fn(() => '2026-01-01'),
  pushMock: vi.fn(),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    addChallenge: addChallengeMock,
    transitionChallenge: transitionChallengeMock,
  },
}));

vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: () => getDateKeyMock(),
}));

vi.mock('@/hooks/use-custom-challenge-queue', () => ({
  useCustomChallengeQueue: useCustomChallengeQueueMock,
}));

vi.mock('@/contexts/debug-context', () => ({
  useDebugMode: () => ({ isDebugMode: false }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('./dashboard-helpers', () => ({
  getDynamicChallenge: vi.fn(),
  getDynamicGoal: vi.fn(() => ({ id: 'fallback-goal', title: 'Fallback Goal', actions: [] })),
  getDynamicLearningTopics: vi.fn(() => []),
}));

vi.mock('./habits-section', () => ({
  HabitsSection: () => <div>Habits</div>,
}));

vi.mock('./inline-calibration', () => ({
  InlineCalibration: () => null,
}));

vi.mock('@/components/FocusItem', () => ({
  ChallengeCard: ({
    challenge,
    onAdvanceQueue,
    onSkipAndReplace,
  }: {
    challenge: { id: string; title: string };
    onAdvanceQueue?: () => Promise<void>;
    onSkipAndReplace?: (challengeId: string, existingChallengeTitles: string[]) => void;
  }) => (
    <>
      <button onClick={() => void onAdvanceQueue?.()}>
        {challenge.title}
      </button>
      <button onClick={() => onSkipAndReplace?.(challenge.id, [challenge.title])}>
        Skip {challenge.title}
      </button>
    </>
  ),
  GoalCard: () => <div>Goal</div>,
  TopicCard: () => <div>Topic</div>,
}));

describe('DailyFocusSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addChallengeMock.mockResolvedValue(undefined);
    transitionChallengeMock.mockResolvedValue(undefined);
    advanceQueueMock.mockResolvedValue(undefined);
  });

  it('records active custom challenge in focus history before advancing queue', async () => {
    const customChallenge = {
      id: 'custom-1',
      title: 'Custom Queue Challenge',
      description: 'desc',
      language: 'TypeScript',
      difficulty: 'beginner',
      whyThisChallenge: [],
      isCustom: true,
    };

    useCustomChallengeQueueMock.mockReturnValue({
      activeChallenge: customChallenge,
      activeSource: 'custom-queue',
      queueRemaining: 2,
      advanceQueue: advanceQueueMock,
    });

    const aiFocus: FocusResponse = {
      challenge: customChallenge,
      goal: { id: 'goal-1', title: 'Goal', actions: [] },
      learningTopics: [],
      calibrationNeeded: [],
      meta: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        aiEnabled: true,
        model: 'test-model',
        toolsUsed: [],
        totalTimeMs: 1,
        usedCachedProfile: false,
      },
    };

    render(
      <DailyFocusSection
        profile={null}
        isLoading={false}
        aiFocus={aiFocus}
        isAIEnabled={true}
        toolsUsed={[]}
        loadingComponents={[]}
        componentTimestamps={{ challenge: null, goal: null, learningTopics: null }}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Custom Queue Challenge' }));

    await waitFor(() => {
      expect(addChallengeMock).toHaveBeenCalledWith('2026-01-01', customChallenge);
      expect(transitionChallengeMock).toHaveBeenCalledWith(
        '2026-01-01',
        'custom-1',
        'completed',
        'advance-queue'
      );
      expect(advanceQueueMock).toHaveBeenCalledTimes(1);
    });

    expect(addChallengeMock.mock.invocationCallOrder[0]).toBeLessThan(
      transitionChallengeMock.mock.invocationCallOrder[0]
    );
    expect(transitionChallengeMock.mock.invocationCallOrder[0]).toBeLessThan(
      advanceQueueMock.mock.invocationCallOrder[0]
    );
  });

  it('marks custom challenge skipped and advances queue when skipping', async () => {
    const customChallenge = {
      id: 'custom-skip-1',
      title: 'Custom Queue Skip Challenge',
      description: 'desc',
      language: 'TypeScript',
      difficulty: 'beginner',
      whyThisChallenge: [],
      isCustom: true,
    };
    const onSkipChallenge = vi.fn();

    useCustomChallengeQueueMock.mockReturnValue({
      activeChallenge: customChallenge,
      activeSource: 'custom-queue',
      queueRemaining: 2,
      advanceQueue: advanceQueueMock,
    });

    const aiFocus: FocusResponse = {
      challenge: customChallenge,
      goal: { id: 'goal-1', title: 'Goal', actions: [] },
      learningTopics: [],
      calibrationNeeded: [],
      meta: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        aiEnabled: true,
        model: 'test-model',
        toolsUsed: [],
        totalTimeMs: 1,
        usedCachedProfile: false,
      },
    };

    render(
      <DailyFocusSection
        profile={null}
        isLoading={false}
        aiFocus={aiFocus}
        isAIEnabled={true}
        toolsUsed={[]}
        loadingComponents={[]}
        componentTimestamps={{ challenge: null, goal: null, learningTopics: null }}
        onRefresh={vi.fn()}
        onSkipChallenge={onSkipChallenge}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip Custom Queue Skip Challenge' }));

    await waitFor(() => {
      expect(addChallengeMock).toHaveBeenCalledWith('2026-01-01', customChallenge);
      expect(transitionChallengeMock).toHaveBeenCalledWith(
        '2026-01-01',
        'custom-skip-1',
        'skipped',
        'skip-queue'
      );
      expect(advanceQueueMock).toHaveBeenCalledTimes(1);
    });
    expect(onSkipChallenge).not.toHaveBeenCalled();
    expect(addChallengeMock.mock.invocationCallOrder[0]).toBeLessThan(
      transitionChallengeMock.mock.invocationCallOrder[0]
    );
    expect(transitionChallengeMock.mock.invocationCallOrder[0]).toBeLessThan(
      advanceQueueMock.mock.invocationCallOrder[0]
    );
  });
});
