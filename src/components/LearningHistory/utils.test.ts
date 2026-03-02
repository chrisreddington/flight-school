import { describe, it, expect } from 'vitest';
import {
  generate52WeekActivity,
  getItemStatus,
  groupEntriesByMonth,
  matchesSearch,
} from './utils';
import type { HistoryEntry, HistoryItem } from './types';

function createChallengeItem(overrides?: Partial<Extract<HistoryItem, { type: 'challenge' }>['data']>): HistoryItem {
  return {
    type: 'challenge',
    timestamp: '2026-01-01T10:00:00.000Z',
    status: 'active',
    data: {
      id: 'challenge-1',
      title: 'TypeScript Arrays',
      description: 'Practice array transformations',
      difficulty: 'beginner',
      language: 'TypeScript',
      estimatedTime: '30 minutes',
      whyThisChallenge: ['improve fundamentals'],
      ...overrides,
    },
  };
}

function createGoalItem(overrides?: Partial<Extract<HistoryItem, { type: 'goal' }>['data']>): HistoryItem {
  return {
    type: 'goal',
    timestamp: '2026-01-01T10:00:00.000Z',
    status: 'active',
    data: {
      id: 'goal-1',
      title: 'Ship weekly feature',
      description: 'Complete a scoped feature by Friday',
      progress: 0,
      target: '1 feature',
      reasoning: 'Build delivery consistency',
      ...overrides,
    },
  };
}

function createTopicItem(overrides?: Partial<Extract<HistoryItem, { type: 'topic' }>['data']>): HistoryItem {
  return {
    type: 'topic',
    timestamp: '2026-01-01T10:00:00.000Z',
    status: 'active',
    data: {
      id: 'topic-1',
      title: 'Render performance',
      description: 'Understand rendering bottlenecks',
      type: 'concept',
      relatedTo: 'react',
      ...overrides,
    },
  };
}

function createHabitItem(overrides?: Partial<Extract<HistoryItem, { type: 'habit' }>['data']>): HistoryItem {
  return {
    type: 'habit',
    timestamp: '2026-01-01T10:00:00.000Z',
    status: 'active',
    data: {
      id: 'habit-1',
      title: 'Read docs daily',
      description: 'Read technical docs for 20 minutes',
      tracking: { mode: 'time', minMinutes: 20 },
      totalDays: 30,
      includesWeekends: true,
      allowedSkips: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      currentDay: 0,
      skipsUsed: 0,
      state: 'active',
      checkIns: [],
      ...overrides,
    },
  };
}

function createEntry(dateKey: string, count = 0): HistoryEntry {
  return {
    dateKey,
    displayDate: dateKey,
    items: Array.from({ length: count }, (_, i) =>
      createChallengeItem({ id: `challenge-${dateKey}-${i}`, title: `Challenge ${i}` })
    ),
    totalCount: count,
    completedCount: 0,
    skippedCount: 0,
  };
}

describe('getItemStatus', () => {
  it.each([
    { stateHistory: undefined, expected: 'active' },
    { stateHistory: [], expected: 'active' },
    { stateHistory: [{ state: 'completed' }], expected: 'completed' },
    { stateHistory: [{ state: 'explored' }], expected: 'completed' },
    { stateHistory: [{ state: 'skipped' }], expected: 'skipped' },
    { stateHistory: [{ state: 'abandoned' }], expected: 'skipped' },
    { stateHistory: [{ state: 'in-progress' }], expected: 'active' },
  ])('should return $expected when stateHistory is $stateHistory', ({ stateHistory, expected }) => {
    expect(getItemStatus(stateHistory)).toBe(expected);
  });
});

describe('matchesSearch', () => {
  const challengeItem = createChallengeItem();

  it('should return true when query is empty', () => {
    expect(matchesSearch(challengeItem, '')).toBe(true);
  });

  it('should return true when query is whitespace-only', () => {
    expect(matchesSearch(challengeItem, '   \n\t   ')).toBe(true);
  });

  it('should return true when title matches query case-insensitively', () => {
    expect(matchesSearch(challengeItem, 'typescript ARRAYS')).toBe(true);
  });

  it('should return true when description includes query', () => {
    expect(matchesSearch(challengeItem, 'array transformations')).toBe(true);
  });

  it('should return false when query matches no searchable fields', () => {
    expect(matchesSearch(challengeItem, 'nonexistent keyword')).toBe(false);
  });

  it.each([
    {
      item: createChallengeItem({ language: 'Rust' }),
      query: 'rust',
      type: 'challenge',
    },
    {
      item: createGoalItem({ description: 'Improve test reliability' }),
      query: 'reliability',
      type: 'goal',
    },
    {
      item: createTopicItem({ relatedTo: 'state management' }),
      query: 'state management',
      type: 'topic',
    },
    {
      item: createHabitItem({ description: 'Practice deliberate coding daily' }),
      query: 'deliberate coding',
      type: 'habit',
    },
  ])('should return true when $type item contains query in its own searchable fields', ({ item, query }) => {
    expect(matchesSearch(item, query)).toBe(true);
  });
});

describe('generate52WeekActivity', () => {
  it('should return activity where no date is in the future when generating the grid', () => {
    const activity = generate52WeekActivity([]);
    const todayKey = new Date().toISOString().split('T')[0];

    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every(day => day.date <= todayKey)).toBe(true);
  });

  it('should return correct count for dates with matching entries when entries exist', () => {
    const emptyActivity = generate52WeekActivity([]);
    const firstDate = emptyActivity[0].date;
    const middleDate = emptyActivity[Math.floor(emptyActivity.length / 2)].date;

    const entries = [createEntry(firstDate, 2), createEntry(middleDate, 4)];
    const activity = generate52WeekActivity(entries);

    expect(activity.find(day => day.date === firstDate)?.count).toBe(2);
    expect(activity.find(day => day.date === middleDate)?.count).toBe(4);
  });

  it('should return zero count when a date has no matching entry', () => {
    const emptyActivity = generate52WeekActivity([]);
    const entryDate = emptyActivity[0].date;
    const dateWithoutEntry = emptyActivity.find(day => day.date !== entryDate);

    expect(dateWithoutEntry).toBeDefined();

    const activity = generate52WeekActivity([createEntry(entryDate, 3)]);
    expect(activity.find(day => day.date === dateWithoutEntry!.date)?.count).toBe(0);
  });

  it('should return weekIndex and dayOfWeek within expected bounds when generating the grid', () => {
    const activity = generate52WeekActivity([]);

    activity.forEach(day => {
      expect(day.weekIndex).toBeGreaterThanOrEqual(0);
      expect(day.weekIndex).toBeLessThanOrEqual(51);
      expect(day.dayOfWeek).toBeGreaterThanOrEqual(0);
      expect(day.dayOfWeek).toBeLessThanOrEqual(6);
    });
  });
});

describe('groupEntriesByMonth', () => {
  it('should group entries together when they are in the same month', () => {
    const jan1 = createEntry('2026-01-01', 1);
    const jan15 = createEntry('2026-01-15', 2);

    const grouped = groupEntriesByMonth([jan1, jan15]);

    expect(grouped.size).toBe(1);
    const onlyGroup = Array.from(grouped.values())[0];
    expect(onlyGroup).toHaveLength(2);
    expect(onlyGroup).toEqual([jan1, jan15]);
  });

  it('should create different month keys when entries are in different months', () => {
    const jan = createEntry('2026-01-31', 1);
    const feb = createEntry('2026-02-01', 1);

    const grouped = groupEntriesByMonth([jan, feb]);

    expect(grouped.size).toBe(2);
    expect(Array.from(grouped.keys())).toContain('January 2026');
    expect(Array.from(grouped.keys())).toContain('February 2026');
  });

  it('should return an empty map when input entries are empty', () => {
    const grouped = groupEntriesByMonth([]);

    expect(grouped).toBeInstanceOf(Map);
    expect(grouped.size).toBe(0);
  });
});
