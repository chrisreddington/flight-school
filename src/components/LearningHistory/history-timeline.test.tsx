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
    accessibleDate: dateKey,
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
  it('threads one timeline item per day and accents the rail badge of today only', () => {
    // Today is deliberately the SECOND entry so the test fails if the badge
    // accent is tied to position rather than to the today day.
    const { container } = render(
      <HistoryTimeline
        entries={[makeEntry('2024-01-01'), makeEntry('2024-01-02')]}
        todayDateKey="2024-01-02"
        collapsedDays={new Set()}
        onToggleDayCollapse={() => {}}
        {...handlers}
      />,
    );

    expect(screen.getAllByTestId('history-entry')).toHaveLength(2);

    // The accent badge must live in the SAME Timeline.Item as the today day,
    // and the past day's item must carry no variant at all.
    const todayItem = container.querySelector('[data-today="true"]')?.closest('.Timeline-Item');
    const pastItem = container.querySelector('[data-today="false"]')?.closest('.Timeline-Item');
    expect(todayItem).not.toBeNull();
    expect(pastItem).not.toBeNull();
    expect(todayItem?.querySelectorAll('[data-variant="accent"]')).toHaveLength(1);
    expect(pastItem?.querySelectorAll('[data-variant]')).toHaveLength(0);
  });

  it('renders the rail calendar badge as a decorative, unnamed marker', () => {
    const { container } = render(
      <HistoryTimeline
        entries={[makeEntry('2024-01-01'), makeEntry('2024-01-02')]}
        todayDateKey="2024-01-02"
        collapsedDays={new Set()}
        onToggleDayCollapse={() => {}}
        {...handlers}
      />,
    );

    // One decorative calendar icon per day, scoped to the Timeline badge rail so
    // unrelated icons elsewhere can't satisfy the count. The accessible date
    // lives in the day header inside Timeline.Body, never on the rail badge, so
    // the rail must contribute no accessible image to the tree.
    const railIcons = container.querySelectorAll('[class*="TimelineBadge"] svg[aria-hidden="true"]');
    expect(railIcons).toHaveLength(2);
    expect(screen.queryByRole('img')).toBeNull();
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
