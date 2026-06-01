import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FocusHistory } from '@/lib/focus/types';
import type { HabitWithHistory } from '@/lib/habits/types';
import {
  buildHistoryEntries,
  buildLearningHistoryViewModel,
  countCompletedGoals,
} from './use-learning-history-view-model';

const todayDateKey = '2026-01-03';

function createHistory(): FocusHistory {
  return {
    '2026-01-02': {
      challenges: [
        {
          data: {
            id: 'challenge-1',
            title: 'TypeScript Arrays',
            description: 'Practice map and filter',
            difficulty: 'beginner',
            language: 'TypeScript',
            estimatedTime: '30 minutes',
            whyThisChallenge: ['practice fundamentals'],
          },
          stateHistory: [
            { state: 'not-started', timestamp: '2026-01-02T09:00:00.000Z' },
            { state: 'completed', timestamp: '2026-01-02T10:00:00.000Z' },
          ],
        },
      ],
      goals: [
        {
          data: {
            id: 'goal-1',
            title: 'Ship a refactor',
            description: 'Make a module easier to maintain',
            progress: 1,
            target: '1 refactor',
            reasoning: 'Keep the codebase lean',
          },
          stateHistory: [
            { state: 'not-started', timestamp: '2026-01-02T08:00:00.000Z' },
            { state: 'completed', timestamp: '2026-01-02T11:00:00.000Z' },
          ],
        },
      ],
      learningTopics: [
        [
          {
            data: {
              id: 'topic-1',
              title: 'React memoization',
              description: 'Understand memo boundaries',
              type: 'concept',
              relatedTo: 'React',
            },
            stateHistory: [{ state: 'not-explored', timestamp: '2026-01-02T07:00:00.000Z' }],
          },
        ],
      ],
    },
    [todayDateKey]: {
      challenges: [],
      goals: [],
      learningTopics: [
        [
          {
            data: {
              id: 'topic-2',
              title: 'Accessibility checks',
              description: 'Review keyboard navigation',
              type: 'best-practice',
              relatedTo: 'a11y',
            },
            stateHistory: [{ state: 'skipped', timestamp: '2026-01-03T09:00:00.000Z' }],
          },
        ],
      ],
    },
  };
}

function createHabit(): HabitWithHistory {
  return {
    id: 'habit-1',
    title: 'Read docs',
    description: 'Read technical docs daily',
    tracking: { mode: 'time', minMinutes: 20 },
    totalDays: 30,
    includesWeekends: true,
    allowedSkips: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    currentDay: 1,
    skipsUsed: 0,
    state: 'active',
    checkIns: [
      {
        date: '2026-01-02',
        value: 20,
        completed: true,
        timestamp: '2026-01-02T12:00:00.000Z',
      },
    ],
  };
}

describe('LearningHistory view model', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should build sorted entries with focus items and habit check-ins', () => {
    const entries = buildHistoryEntries(createHistory(), { habits: [createHabit()] }, todayDateKey);

    expect(entries.map((entry) => entry.dateKey)).toEqual([todayDateKey, '2026-01-02']);
    expect(entries.find((entry) => entry.dateKey === '2026-01-02')?.items.map((item) => item.type)).toEqual([
      'habit',
      'challenge',
      'goal',
      'topic',
    ]);
    expect(entries.find((entry) => entry.dateKey === '2026-01-02')).toMatchObject({
      totalCount: 4,
      completedCount: 3,
      skippedCount: 0,
    });
  });

  it('should filter by date, type, status, and search query while keeping active today rows', () => {
    const entries = buildHistoryEntries(createHistory(), { habits: [createHabit()] }, todayDateKey);

    const viewModel = buildLearningHistoryViewModel({
      entries,
      selectedDate: todayDateKey,
      typeFilter: 'challenge',
      statusFilter: 'active',
      searchQuery: 'does not match',
      todayDateKey,
      activeTopicCount: 1,
      insights: null,
      totalGoalsCompleted: 1,
    });

    expect(viewModel.filteredEntries).toEqual([
      expect.objectContaining({
        dateKey: todayDateKey,
        items: [],
      }),
    ]);
    expect(viewModel.stats).toEqual({
      total: 2,
      completed: 0,
      skipped: 1,
      active: 1,
      challenges: 0,
      goals: 0,
      topics: 1,
      habits: 1,
    });
  });

  it('should derive grouped navigation and activity buckets from all entries', () => {
    const entries = buildHistoryEntries(createHistory(), { habits: [createHabit()] }, todayDateKey);
    const viewModel = buildLearningHistoryViewModel({
      entries,
      selectedDate: null,
      typeFilter: 'all',
      statusFilter: 'all',
      searchQuery: '',
      todayDateKey,
      activeTopicCount: 0,
      insights: {
        currentStreak: 0,
        longestStreak: 0,
        totalChallengesCompleted: 1,
        totalTopicsExplored: 0,
        challengesByDifficulty: { beginner: 1, intermediate: 0, advanced: 0 },
        challengesByLanguage: { TypeScript: 1 },
        recentActivity: [],
      },
      totalGoalsCompleted: 1,
    });

    expect(Array.from(viewModel.groupedEntries.keys())).toContain('January 2026');
    expect(viewModel.activityData.find((day) => day.date === '2026-01-02')?.count).toBe(4);
    expect(viewModel.hasNoInsightsHistory).toBe(false);
  });

  it('should count goals that were ever completed', () => {
    expect(countCompletedGoals(createHistory())).toBe(1);
  });

  it('should include days that only have habit check-ins and no focus record', () => {
    // Pin the clock so the 52-week activity window is anchored to the fixture's
    // todayDateKey (2026-01-03); otherwise 2025-12-31 would eventually fall out
    // of the rolling window and the activity-cell assertion would age out.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T12:00:00'));

    const habit = createHabit();
    // A check-in on a date that has no focus record at all — the kind of day
    // (e.g. a weekend habit log with no generated focus) the timeline used to
    // drop entirely because it only iterated focus-history dates.
    habit.checkIns.push({
      date: '2025-12-31',
      value: 25,
      completed: true,
      timestamp: '2025-12-31T08:00:00.000Z',
    });

    const entries = buildHistoryEntries(createHistory(), { habits: [habit] }, todayDateKey);

    const habitOnlyDay = entries.find((entry) => entry.dateKey === '2025-12-31');
    expect(habitOnlyDay?.items.map((item) => item.type)).toEqual(['habit']);
    expect(habitOnlyDay?.completedCount).toBe(1);
    // The habit-only day threads into the same descending day order as focus days.
    expect(entries.map((entry) => entry.dateKey)).toEqual([todayDateKey, '2026-01-02', '2025-12-31']);

    const viewModel = buildLearningHistoryViewModel({
      entries,
      selectedDate: null,
      typeFilter: 'all',
      statusFilter: 'all',
      searchQuery: '',
      todayDateKey,
      activeTopicCount: 0,
      insights: null,
      totalGoalsCompleted: 0,
    });
    // The activity graph cell and stats now reflect the habit-only day.
    expect(viewModel.activityData.find((day) => day.date === '2025-12-31')?.count).toBe(1);
    expect(viewModel.stats.habits).toBe(3);
  });

  it('should mark a habit-only skipped check-in as skipped, not active', () => {
    const habit = createHabit();
    // `skipHabitDay` records a skip as `value: false`. The day must read as
    // skipped — matching the Skipped filter and stats — not a plain incomplete
    // (active) check-in, which would hide the skip from the skipped views.
    habit.checkIns.push({
      date: '2025-12-30',
      value: false,
      completed: false,
      timestamp: '2025-12-30T08:00:00.000Z',
    });

    const entries = buildHistoryEntries(createHistory(), { habits: [habit] }, todayDateKey);

    const skippedDay = entries.find((entry) => entry.dateKey === '2025-12-30');
    expect(skippedDay?.items.map((item) => item.status)).toEqual(['skipped']);
    expect(skippedDay?.skippedCount).toBe(1);

    const viewModel = buildLearningHistoryViewModel({
      entries,
      selectedDate: null,
      typeFilter: 'all',
      statusFilter: 'skipped',
      searchQuery: '',
      todayDateKey,
      activeTopicCount: 0,
      insights: null,
      totalGoalsCompleted: 0,
    });
    // The skipped habit day survives the Skipped filter and lifts skipped stats
    // alongside the existing skipped topic on today.
    expect(
      viewModel.filteredEntries.find((entry) => entry.dateKey === '2025-12-30')?.items.map((item) => item.status),
    ).toEqual(['skipped']);
    expect(viewModel.stats.skipped).toBe(2);
  });

  it('should surface today pending active habits even with no focus record or check-in', () => {
    // Pin the clock so the activity window aligns with todayDateKey.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-03T12:00:00'));

    const habit = createHabit();
    habit.checkIns = [];

    // Empty focus history and no check-in: the only reason today is a learning
    // day is the pending active habit, which the timeline must still surface.
    const entries = buildHistoryEntries({}, { habits: [habit] }, todayDateKey);

    const todayEntry = entries.find((entry) => entry.dateKey === todayDateKey);
    expect(todayEntry?.items.map((item) => item.type)).toEqual(['habit']);
    expect(todayEntry?.items.map((item) => item.status)).toEqual(['active']);

    const viewModel = buildLearningHistoryViewModel({
      entries,
      selectedDate: null,
      typeFilter: 'all',
      statusFilter: 'all',
      searchQuery: '',
      todayDateKey,
      activeTopicCount: 0,
      insights: null,
      totalGoalsCompleted: 0,
    });
    expect(viewModel.stats.active).toBe(1);
    expect(viewModel.stats.habits).toBe(1);
  });
});
