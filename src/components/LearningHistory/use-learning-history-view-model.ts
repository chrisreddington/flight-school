import type { LearningInsights } from '@/lib/focus/analytics';
import type { DailyFocusRecord, FocusHistory } from '@/lib/focus/types';
import type { DailyCheckIn, HabitCollection, HabitWithHistory } from '@/lib/habits/types';
import type { HistoryEntry, HistoryItem, ItemStatus, Stats, StatusFilter, TypeFilter } from './types';
import {
  formatAccessibleDate,
  formatDateForDisplay,
  generate52WeekActivity,
  getItemStatus,
  groupEntriesByMonth,
  matchesSearch,
} from './utils';

interface LearningHistoryViewModelInput {
  entries: HistoryEntry[];
  selectedDate: string | null;
  typeFilter: TypeFilter;
  statusFilter: StatusFilter;
  searchQuery: string;
  todayDateKey: string;
  activeTopicCount: number;
  insights: LearningInsights | null;
  totalGoalsCompleted: number;
}

/**
 * Empty focus record reused for habit-only days. `buildHistoryEntry` only reads
 * from the record (never mutates it), so a single frozen instance is safe to
 * share across every habit-only date in the feed.
 */
const EMPTY_FOCUS_RECORD: DailyFocusRecord = Object.freeze({
  challenges: [],
  goals: [],
  learningTopics: [],
});

/**
 * Collect every date that should become a history row: the union of focus-history
 * dates, habit check-in dates, and today when any habit is still pending. Keying
 * on focus dates alone would silently drop habit-only days (e.g. a weekend log
 * with no generated focus) and today's not-yet-checked-in active habits, hiding
 * them from the timeline, activity graph, and stats.
 */
function collectHistoryDateKeys(rawHistory: FocusHistory, habits: HabitWithHistory[], todayDateKey: string): string[] {
  const dateKeys = new Set<string>(Object.keys(rawHistory));
  for (const habit of habits) {
    for (const checkIn of habit.checkIns) {
      dateKeys.add(checkIn.date);
    }
  }
  // A pending (active or not-started) habit gives today a not-yet-logged habit
  // to surface; buildHistoryEntry injects it, but only when today is a key.
  const hasPendingHabitToday = habits.some((habit) => habit.state === 'active' || habit.state === 'not-started');
  if (hasPendingHabitToday) {
    dateKeys.add(todayDateKey);
  }
  return Array.from(dateKeys);
}

/**
 * Map a habit check-in to a status: a skip (`value: false`, written only by
 * `skipHabitDay`) is 'skipped'; a met requirement (`completed`) is 'completed';
 * any other logged check-in is 'active'.
 */
function deriveHabitCheckInStatus(checkIn: DailyCheckIn): ItemStatus {
  if (checkIn.value === false) return 'skipped';
  if (checkIn.completed) return 'completed';
  return 'active';
}

export function buildHistoryEntries(
  rawHistory: FocusHistory,
  habitsCollection: HabitCollection,
  todayDateKey: string,
): HistoryEntry[] {
  return collectHistoryDateKeys(rawHistory, habitsCollection.habits, todayDateKey)
    .map((dateKey) =>
      buildHistoryEntry(dateKey, rawHistory[dateKey] ?? EMPTY_FOCUS_RECORD, habitsCollection.habits, todayDateKey),
    )
    .filter((entry) => entry.items.length > 0)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));
}

function buildHistoryEntry(
  dateKey: string,
  record: DailyFocusRecord,
  habits: HabitWithHistory[],
  todayDateKey: string,
): HistoryEntry {
  const items: HistoryItem[] = [];
  let completedCount = 0;
  let skippedCount = 0;

  for (const challenge of record.challenges) {
    if (challenge.stateHistory.length === 0) continue;
    const status = getItemStatus(challenge.stateHistory);
    items.push({
      type: 'challenge',
      data: challenge.data,
      timestamp: challenge.stateHistory[0].timestamp,
      status,
      stateHistory: challenge.stateHistory,
    });
    if (status === 'completed') completedCount++;
    if (status === 'skipped') skippedCount++;
  }

  for (const goal of record.goals) {
    if (goal.stateHistory.length === 0) continue;
    const status = getItemStatus(goal.stateHistory);
    items.push({
      type: 'goal',
      data: goal.data,
      timestamp: goal.stateHistory[0].timestamp,
      status,
      stateHistory: goal.stateHistory,
    });
    if (status === 'completed') completedCount++;
    if (status === 'skipped') skippedCount++;
  }

  for (const topicArray of record.learningTopics) {
    for (const topic of topicArray) {
      if (topic.stateHistory.length === 0) continue;
      const status = getItemStatus(topic.stateHistory);
      items.push({
        type: 'topic',
        data: topic.data,
        timestamp: topic.stateHistory[0].timestamp,
        status,
        stateHistory: topic.stateHistory,
      });
      if (status === 'completed') completedCount++;
      if (status === 'skipped') skippedCount++;
    }
  }

  for (const habit of habits) {
    const checkInForDate = habit.checkIns.find((checkIn: DailyCheckIn) => checkIn.date === dateKey);
    const isActiveHabit = habit.state === 'active' || habit.state === 'not-started';

    if (checkInForDate) {
      const status = deriveHabitCheckInStatus(checkInForDate);
      items.push({
        type: 'habit',
        data: habit,
        timestamp: checkInForDate.timestamp,
        status,
      });
      if (status === 'completed') completedCount++;
      if (status === 'skipped') skippedCount++;
    } else if (dateKey === todayDateKey && isActiveHabit) {
      items.push({
        type: 'habit',
        data: habit,
        timestamp: new Date().toISOString(),
        status: 'active',
      });
    }
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return {
    dateKey,
    displayDate: formatDateForDisplay(dateKey),
    accessibleDate: formatAccessibleDate(dateKey),
    items,
    totalCount: items.length,
    completedCount,
    skippedCount,
  };
}

export function countCompletedGoals(rawHistory: FocusHistory): number {
  let goalsCount = 0;
  for (const dateKey of Object.keys(rawHistory)) {
    for (const goal of rawHistory[dateKey].goals) {
      if (goal.stateHistory.some((transition) => transition.state === 'completed')) {
        goalsCount++;
      }
    }
  }
  return goalsCount;
}

export function buildLearningHistoryViewModel({
  entries,
  selectedDate,
  typeFilter,
  statusFilter,
  searchQuery,
  todayDateKey,
  activeTopicCount,
  insights,
  totalGoalsCompleted,
}: LearningHistoryViewModelInput) {
  return {
    filteredEntries: filterHistoryEntries({
      entries,
      selectedDate,
      typeFilter,
      statusFilter,
      searchQuery,
      todayDateKey,
      activeTopicCount,
    }),
    activityData: generate52WeekActivity(entries),
    groupedEntries: groupEntriesByMonth(entries),
    stats: calculateHistoryStats(entries, selectedDate),
    hasNoInsightsHistory:
      !insights ||
      (insights.totalChallengesCompleted === 0 && insights.totalTopicsExplored === 0 && totalGoalsCompleted === 0),
  };
}

interface FilterHistoryEntriesInput {
  entries: HistoryEntry[];
  selectedDate: string | null;
  typeFilter: TypeFilter;
  statusFilter: StatusFilter;
  searchQuery: string;
  todayDateKey: string;
  activeTopicCount: number;
}

function filterHistoryEntries({
  entries,
  selectedDate,
  typeFilter,
  statusFilter,
  searchQuery,
  todayDateKey,
  activeTopicCount,
}: FilterHistoryEntriesInput): HistoryEntry[] {
  return entries
    .filter((entry) => !selectedDate || entry.dateKey === selectedDate)
    .map((entry) => ({
      ...entry,
      items: entry.items.filter((item) => {
        if (typeFilter !== 'all' && item.type !== typeFilter) return false;
        if (statusFilter !== 'all' && item.status !== statusFilter) return false;
        if (!matchesSearch(item, searchQuery)) return false;
        return true;
      }),
    }))
    .filter((entry) => entry.items.length > 0 || (entry.dateKey === todayDateKey && activeTopicCount > 0));
}

function calculateHistoryStats(entries: HistoryEntry[], selectedDate: string | null): Stats {
  const relevantEntries = selectedDate ? entries.filter((entry) => entry.dateKey === selectedDate) : entries;

  const stats: Stats = {
    total: 0,
    completed: 0,
    skipped: 0,
    active: 0,
    challenges: 0,
    goals: 0,
    topics: 0,
    habits: 0,
  };

  for (const entry of relevantEntries) {
    for (const item of entry.items) {
      stats.total++;
      if (item.status === 'completed') stats.completed++;
      if (item.status === 'skipped') stats.skipped++;
      if (item.status === 'active') stats.active++;
      if (item.type === 'challenge') stats.challenges++;
      if (item.type === 'goal') stats.goals++;
      if (item.type === 'topic') stats.topics++;
      if (item.type === 'habit') stats.habits++;
    }
  }

  return stats;
}
