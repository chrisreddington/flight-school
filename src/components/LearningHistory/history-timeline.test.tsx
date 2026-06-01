import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryTimeline } from './history-timeline';
import type { HistoryEntry } from './types';

vi.mock('./history-entry-card', () => ({
  HistoryEntryCard: ({
    entry,
    isToday,
    isCollapsed,
    onToggleCollapse,
  }: {
    entry: HistoryEntry;
    isToday: boolean;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
  }) => (
    <div
      data-testid="history-entry"
      data-date={entry.dateKey}
      data-today={String(isToday)}
      data-collapsed={String(isCollapsed)}
    >
      <button type="button" onClick={onToggleCollapse}>
        toggle {entry.dateKey}
      </button>
    </div>
  ),
}));

function makeEntry(dateKey: string): HistoryEntry {
  return {
    dateKey,
    displayDate: dateKey,
    items: [],
    totalCount: 0,
    completedCount: 0,
    skippedCount: 0,
  };
}

const handlers = {
  onRefresh: () => {},
  onSkipTopic: async () => {},
  onSkipChallenge: async () => {},
  onSkipGoal: async () => {},
  onStopSkipTopic: () => {},
  onStopSkipChallenge: () => {},
  onStopSkipGoal: () => {},
  onExploreTopic: async () => {},
  skippingTopicIds: new Set<string>(),
  skippingChallengeIds: new Set<string>(),
  skippingGoalIds: new Set<string>(),
  activeTopicIds: new Set<string>(),
  activeChallengeIds: new Set<string>(),
  activeGoalIds: new Set<string>(),
};

describe('HistoryTimeline', () => {
  it('threads one timeline item per day and flags only today', () => {
    render(
      <HistoryTimeline
        entries={[makeEntry('2024-01-02'), makeEntry('2024-01-01')]}
        todayDateKey="2024-01-02"
        collapsedDays={new Set()}
        onToggleDayCollapse={() => {}}
        {...handlers}
      />,
    );

    const days = screen.getAllByTestId('history-entry');
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveAttribute('data-today', 'true');
    expect(days[1]).toHaveAttribute('data-today', 'false');
  });

  it('renders the rail calendar badge as a decorative (aria-hidden) marker', () => {
    render(
      <HistoryTimeline
        entries={[makeEntry('2024-01-01'), makeEntry('2024-01-02')]}
        todayDateKey="2024-01-02"
        collapsedDays={new Set()}
        onToggleDayCollapse={() => {}}
        {...handlers}
      />,
    );

    // One decorative calendar icon per day; the accessible date lives in the
    // day header inside Timeline.Body, never on the rail badge.
    expect(document.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it('reflects per-day collapse state changes through the timeline', () => {
    function Harness() {
      const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
      return (
        <HistoryTimeline
          entries={[makeEntry('2024-01-01')]}
          todayDateKey="2024-01-02"
          collapsedDays={collapsedDays}
          onToggleDayCollapse={(dateKey) =>
            setCollapsedDays((current) => {
              const next = new Set(current);
              if (next.has(dateKey)) next.delete(dateKey);
              else next.add(dateKey);
              return next;
            })
          }
          {...handlers}
        />
      );
    }

    render(<Harness />);
    expect(screen.getByTestId('history-entry')).toHaveAttribute('data-collapsed', 'false');

    fireEvent.click(screen.getByRole('button', { name: /toggle 2024-01-01/ }));
    expect(screen.getByTestId('history-entry')).toHaveAttribute('data-collapsed', 'true');
  });
});
