/**
 * LearningHistory Utilities
 *
 * Helper functions for date formatting, filtering, and data processing.
 */

import { getDateKey } from '@/lib/utils/date-utils';
import type { ActivityDay, HistoryEntry, HistoryItem, ItemStatus } from './types';

const WEEKS_TO_SHOW = 52;
const DAYS_IN_WEEK = 7;

/** Format a date key for display (Today, Yesterday, or formatted date) */
export function formatDateForDisplay(dateKey: string): string {
  const date = new Date(dateKey + 'T12:00:00');
  const today = getDateKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  // Use the local date key (not toISOString, which is UTC) so the "Yesterday"
  // label matches the local-date keys the rest of the feature produces; a UTC
  // split would mislabel days for users in timezones behind UTC near midnight.
  const yesterdayKey = getDateKey(yesterday);

  if (dateKey === today) return 'Today';
  if (dateKey === yesterdayKey) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Absolute, unambiguous date for assistive tech — never relative.
 * `formatDateForDisplay` collapses today/yesterday to relative words, which is
 * friendly visually but useless as a screen-reader date; this is the spoken date.
 */
export function formatAccessibleDate(dateKey: string): string {
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Format an ISO timestamp to a time string */
export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Get item status from state history */
export function getItemStatus(stateHistory?: Array<{ state: string }>): ItemStatus {
  if (!stateHistory || stateHistory.length === 0) return 'active';
  const currentState = stateHistory[stateHistory.length - 1].state;
  if (currentState === 'completed' || currentState === 'explored') return 'completed';
  if (currentState === 'skipped' || currentState === 'abandoned') return 'skipped';
  return 'active';
}

/** Check if an item matches a search query */
export function matchesSearch(item: HistoryItem, query: string): boolean {
  if (!query.trim()) return true;
  const lowerQuery = query.toLowerCase();

  switch (item.type) {
    case 'challenge':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description.toLowerCase().includes(lowerQuery) ||
        item.data.language?.toLowerCase().includes(lowerQuery)
      );
    case 'goal':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) || item.data.description.toLowerCase().includes(lowerQuery)
      );
    case 'topic':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) ||
        item.data.description.toLowerCase().includes(lowerQuery) ||
        item.data.relatedTo?.toLowerCase().includes(lowerQuery)
      );
    case 'habit':
      return (
        item.data.title.toLowerCase().includes(lowerQuery) || item.data.description?.toLowerCase().includes(lowerQuery)
      );
  }
}

/** Generate 52-week activity data grid */
export function generate52WeekActivity(entries: HistoryEntry[]): ActivityDay[] {
  const today = new Date();
  const activity: ActivityDay[] = [];

  // Find the start of the current week (Sunday)
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());

  // Go back 51 more weeks to get 52 weeks total (including current week)
  const startDate = new Date(currentWeekStart);
  startDate.setDate(startDate.getDate() - (WEEKS_TO_SHOW - 1) * DAYS_IN_WEEK);

  for (let week = 0; week < WEEKS_TO_SHOW; week++) {
    for (let day = 0; day < DAYS_IN_WEEK; day++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + week * DAYS_IN_WEEK + day);
      // Local date key so grid cells match entry.dateKey (also local); a UTC
      // split would shift counts onto the wrong cell near the day boundary.
      const dateKey = getDateKey(date);

      // Don't include future dates
      if (date > today) continue;

      const entry = entries.find((e) => e.dateKey === dateKey);
      activity.push({
        date: dateKey,
        count: entry ? entry.items.length : 0,
        weekIndex: week,
        dayOfWeek: day,
      });
    }
  }

  return activity;
}

/** Group entries by month for sidebar navigation */
export function groupEntriesByMonth(entries: HistoryEntry[]): Map<string, HistoryEntry[]> {
  const grouped = new Map<string, HistoryEntry[]>();

  entries.forEach((entry) => {
    const date = new Date(entry.dateKey + 'T12:00:00');
    const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(entry);
  });

  return grouped;
}
