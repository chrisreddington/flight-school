import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FocusResponse } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  focusStore: {
    getTodaysFocus: vi.fn(),
    isNewDay: vi.fn(),
    saveCompleteFocusResponse: vi.fn(),
    saveTodaysFocus: vi.fn(),
  },
  skillsStore: {
    get: vi.fn(),
  },
  subscribeFocusInvalidate: vi.fn(),
  broadcastFocusInvalidate: vi.fn(),
  regenerateChallengeAction: vi.fn(),
  useFocusSkip: vi.fn(),
  useFocusStorageSubscriptions: vi.fn(),
  useOperationRegenerations: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiPost: mocks.apiPost,
}));

vi.mock('@/lib/focus', () => ({
  focusStore: mocks.focusStore,
}));

vi.mock('@/lib/skills/storage', () => ({
  skillsStore: mocks.skillsStore,
}));

vi.mock('@/lib/operations/focus-broadcast', () => ({
  subscribeFocusInvalidate: mocks.subscribeFocusInvalidate,
  broadcastFocusInvalidate: mocks.broadcastFocusInvalidate,
}));

vi.mock('@/app/challenge/actions', () => ({
  regenerateChallengeAction: mocks.regenerateChallengeAction,
}));

vi.mock('./use-focus-skip', () => ({
  useFocusSkip: mocks.useFocusSkip,
}));

vi.mock('./use-focus-storage-subscriptions', () => ({
  useFocusStorageSubscriptions: mocks.useFocusStorageSubscriptions,
}));

vi.mock('./use-operation-regenerations', () => ({
  useOperationRegenerations: mocks.useOperationRegenerations,
}));

import { useAIFocus } from './use-ai-focus';

function buildProfile(lastUpdated: string): SkillProfile {
  return {
    skills: [{ skillId: 'typescript', level: 'intermediate', source: 'manual' }],
    lastUpdated,
  };
}

function buildFocusResponse(skillProfileLastUpdated: string): FocusResponse {
  return {
    challenge: {
      id: 'challenge-1',
      title: 'Challenge',
      description: 'desc',
      difficulty: 'beginner',
      language: 'TypeScript',
      estimatedMinutes: 20,
      tags: ['ts'],
    },
    goal: {
      id: 'goal-1',
      title: 'Goal',
      description: 'desc',
      category: 'technical',
      estimatedMinutes: 10,
    },
    learningTopics: [
      {
        id: 'topic-1',
        title: 'Topic',
        description: 'desc',
        category: 'language',
        estimatedMinutes: 10,
        resources: [],
      },
    ],
    meta: {
      generatedAt: '2026-05-01T00:00:00.000Z',
      aiEnabled: true,
      model: 'gpt-5-mini',
      toolsUsed: ['copilot'],
      totalTimeMs: 100,
      usedCachedProfile: true,
      skillProfileLastUpdated,
    },
  };
}

describe('useAIFocus', () => {
  let invalidateHandler: (() => void) | null = null;
  const unsubscribeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    invalidateHandler = null;

    mocks.useFocusSkip.mockReturnValue({
      skipAndReplaceTopic: vi.fn(),
      skipAndReplaceChallenge: vi.fn(),
      skipAndReplaceGoal: vi.fn(),
      stopTopicSkip: vi.fn(),
      stopChallengeSkip: vi.fn(),
      stopGoalSkip: vi.fn(),
      cancelAllSkips: vi.fn(),
    });

    mocks.useOperationRegenerations.mockReturnValue({
      skippingTopicIds: new Set(),
      skippingChallengeIds: new Set(),
      skippingGoalIds: new Set(),
    });

    mocks.useFocusStorageSubscriptions.mockImplementation(() => undefined);

    mocks.subscribeFocusInvalidate.mockImplementation((handler: () => void) => {
      invalidateHandler = handler;
      return unsubscribeMock;
    });

    mocks.regenerateChallengeAction.mockResolvedValue({ ok: false, error: 'unused' });
    mocks.focusStore.saveTodaysFocus.mockResolvedValue(undefined);
  });

  it('collapses first-load generation into one combined POST and persists the complete response once', async () => {
    const skillProfile = buildProfile('2026-05-05T00:00:00.000Z');
    const response = buildFocusResponse(skillProfile.lastUpdated);

    mocks.skillsStore.get.mockResolvedValue(skillProfile);
    mocks.focusStore.getTodaysFocus.mockResolvedValue(null);
    mocks.focusStore.isNewDay.mockResolvedValue(true);
    mocks.apiPost.mockResolvedValueOnce(response).mockRejectedValue(new Error('unexpected extra network call'));
    mocks.focusStore.saveCompleteFocusResponse.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAIFocus());

    await waitFor(() => expect(result.current.data?.challenge.id).toBe('challenge-1'));
    expect(result.current.error).toBeNull();
    expect(result.current.toolsUsed).toEqual(['copilot']);
  });

  it('uses cached focus when profile timestamp matches and skips network', async () => {
    const skillProfile = buildProfile('2026-05-05T00:00:00.000Z');
    const cached = buildFocusResponse(skillProfile.lastUpdated);

    mocks.skillsStore.get.mockResolvedValue(skillProfile);
    mocks.focusStore.getTodaysFocus.mockResolvedValue(cached);
    mocks.focusStore.isNewDay.mockResolvedValue(false);

    const { result } = renderHook(() => useAIFocus());

    await waitFor(() => expect(result.current.data?.challenge.id).toBe('challenge-1'));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.meta.skillProfileLastUpdated).toBe(skillProfile.lastUpdated);
  });

  it('refetches when cached skill profile timestamp is stale', async () => {
    const skillProfile = buildProfile('2026-05-05T00:00:00.000Z');
    const staleCached = buildFocusResponse('2026-05-01T00:00:00.000Z');
    const freshResponse = buildFocusResponse(skillProfile.lastUpdated);

    mocks.skillsStore.get.mockResolvedValue(skillProfile);
    mocks.focusStore.getTodaysFocus.mockResolvedValue(staleCached);
    mocks.focusStore.isNewDay.mockResolvedValue(false);
    mocks.apiPost.mockResolvedValueOnce(freshResponse).mockRejectedValue(new Error('unexpected extra network call'));
    mocks.focusStore.saveCompleteFocusResponse.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAIFocus());

    await waitFor(() => expect(result.current.data?.meta.skillProfileLastUpdated).toBe(skillProfile.lastUpdated));
    expect(result.current.error).toBeNull();
    expect(result.current.data?.challenge.id).toBe('challenge-1');
  });

  it('subscribes to focus invalidation and refetches via combined request when notified', async () => {
    const skillProfile = buildProfile('2026-05-05T00:00:00.000Z');
    const cached = buildFocusResponse(skillProfile.lastUpdated);
    const refreshed = buildFocusResponse(skillProfile.lastUpdated);

    mocks.skillsStore.get.mockResolvedValue(skillProfile);
    mocks.focusStore.getTodaysFocus.mockResolvedValueOnce(cached).mockResolvedValueOnce(null);
    mocks.focusStore.isNewDay.mockResolvedValue(false);
    mocks.apiPost.mockResolvedValueOnce(refreshed).mockRejectedValue(new Error('unexpected extra network call'));
    mocks.focusStore.saveCompleteFocusResponse.mockResolvedValue(undefined);

    const { result, unmount } = renderHook(() => useAIFocus());

    await waitFor(() => expect(result.current.data?.challenge.id).toBe('challenge-1'));
    expect(result.current.error).toBeNull();

    await act(async () => {
      invalidateHandler?.();
    });

    await waitFor(() => expect(result.current.data?.challenge.id).toBe('challenge-1'));
    expect(result.current.error).toBeNull();

    unmount();
    expect(unsubscribeMock.mock.calls.length).toBe(1);
  });
});
