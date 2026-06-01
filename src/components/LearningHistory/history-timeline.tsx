/**
 * HistoryTimeline Component
 *
 * Threads the day-grouped learning history onto a Primer `Timeline`, so the
 * feed reads as a vertical chronological activity rail (Option A from the HI1
 * panel review: the Timeline threads *days*, not individual items).
 *
 * Each day is one `Timeline.Item`. The rail badge is a decorative calendar
 * marker — `accent` for today, neutral for past days — while the real,
 * keyboard-operable day collapse control and the day's items live inside
 * `Timeline.Body` via the existing `HistoryEntryCard`. Per-day and per-item
 * collapse behaviour is unchanged.
 */

import { CalendarIcon } from '@primer/octicons-react';
import { Timeline } from '@primer/react';
import { HistoryEntryCard, type HistoryEntryHandlers } from './history-entry-card';
import type { HistoryEntry } from './types';

interface HistoryTimelineProps extends HistoryEntryHandlers {
  entries: HistoryEntry[];
  todayDateKey: string;
  collapsedDays: Set<string>;
  onToggleDayCollapse: (dateKey: string) => void;
}

export function HistoryTimeline({
  entries,
  todayDateKey,
  collapsedDays,
  onToggleDayCollapse,
  ...handlers
}: HistoryTimelineProps) {
  return (
    <Timeline clipSidebar>
      {entries.map((entry) => {
        const isToday = entry.dateKey === todayDateKey;
        return (
          <Timeline.Item key={entry.dateKey}>
            <Timeline.Badge variant={isToday ? 'accent' : undefined}>
              <CalendarIcon aria-hidden />
            </Timeline.Badge>
            <Timeline.Body>
              <HistoryEntryCard
                entry={entry}
                isToday={isToday}
                isCollapsed={collapsedDays.has(entry.dateKey)}
                onToggleCollapse={() => onToggleDayCollapse(entry.dateKey)}
                {...handlers}
              />
            </Timeline.Body>
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}
