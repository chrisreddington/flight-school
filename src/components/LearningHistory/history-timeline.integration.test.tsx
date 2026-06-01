import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryTimeline } from './history-timeline';
import type { HistoryEntry, HistoryItem } from './types';

// Mock only the leaf focus cards: this test exercises the real composition of
// HistoryTimeline -> HistoryEntryCard -> ItemCard so the day-threading and
// mounted-but-hidden invariants are verified end to end, not against stubs.
vi.mock('@/components/FocusItem', () => ({
  ChallengeCard: () => <div data-testid="challenge-card" />,
  GoalCard: () => <div data-testid="goal-card" />,
  TopicCard: ({ topic }: { topic: { title: string } }) => <div data-testid="topic-detail">{topic.title}</div>,
  HabitHistoryCard: () => <div data-testid="habit-card" />,
}));

const noop = () => {};
const asyncNoop = async () => {};

function completedTopic(id: string, title: string): HistoryItem {
  return {
    type: 'topic',
    data: { id, title } as HistoryItem['data'],
    timestamp: '2024-01-01T10:00:00.000Z',
    status: 'completed',
  } as HistoryItem;
}

function makeEntry(dateKey: string, title: string): HistoryEntry {
  return {
    dateKey,
    displayDate: dateKey,
    items: [completedTopic(`${dateKey}-topic`, title)],
    totalCount: 1,
    completedCount: 1,
    skippedCount: 0,
  };
}

/**
 * Owns the per-day collapse Set the way the real LearningHistory root does, so
 * the integration test can toggle whole days and assert what survives.
 */
function TimelineHarness({ entries }: { entries: HistoryEntry[] }) {
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  return (
    <HistoryTimeline
      entries={entries}
      todayDateKey={entries[0]?.dateKey ?? ''}
      collapsedDays={collapsedDays}
      onToggleDayCollapse={(dateKey) =>
        setCollapsedDays((previous) => {
          const next = new Set(previous);
          if (next.has(dateKey)) {
            next.delete(dateKey);
          } else {
            next.add(dateKey);
          }
          return next;
        })
      }
      onRefresh={noop}
      onSkipTopic={asyncNoop}
      onSkipChallenge={asyncNoop}
      onSkipGoal={asyncNoop}
      onStopSkipTopic={noop}
      onStopSkipChallenge={noop}
      onStopSkipGoal={noop}
      onExploreTopic={asyncNoop}
      skippingTopicIds={new Set()}
      skippingChallengeIds={new Set()}
      skippingGoalIds={new Set()}
      activeTopicIds={new Set()}
      activeChallengeIds={new Set()}
      activeGoalIds={new Set()}
    />
  );
}

describe('HistoryTimeline composition', () => {
  it('threads each day onto its own toggle and keeps collapsed days mounted', () => {
    render(<TimelineHarness entries={[makeEntry('2024-01-02', 'Recursion'), makeEntry('2024-01-01', 'Closures')]} />);

    const day2Header = screen.getByRole('button', { name: /2024-01-02/ });
    const day1Header = screen.getByRole('button', { name: /2024-01-01/ });
    const day1RegionId = day1Header.getAttribute('aria-controls') as string;
    expect(day1RegionId).toBeTruthy();

    const day1Region = document.getElementById(day1RegionId);
    expect(day1Region).toBeInTheDocument();
    expect(day1Region).toBeVisible();
    // Day toggles are independent: collapsing day 1 must not touch day 2.
    expect(day2Header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(day1Header);

    // Hidden but still mounted, and day 2 is untouched.
    expect(document.getElementById(day1RegionId)).toBeInTheDocument();
    expect(day1Region).not.toBeVisible();
    expect(day2Header).toHaveAttribute('aria-expanded', 'true');
  });

  it('preserves an expanded item through a whole-day collapse and re-expand', () => {
    render(<TimelineHarness entries={[makeEntry('2024-01-01', 'Closures')]} />);

    const dayHeader = screen.getByRole('button', { name: /2024-01-01/ });
    const dayRegion = document.getElementById(dayHeader.getAttribute('aria-controls') as string);
    expect(dayRegion).not.toBeNull();

    const itemCard = (dayRegion as HTMLElement).querySelector('[data-item-id="2024-01-01-topic"]') as HTMLElement;
    const itemHeader = within(itemCard).getByRole('button');

    // Completed items render collapsed; expand the item to reveal its detail.
    fireEvent.click(itemHeader);
    expect(itemHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('topic-detail')).toBeInTheDocument();

    // Collapse the entire day, then re-open it.
    fireEvent.click(dayHeader);
    fireEvent.click(dayHeader);

    // The item is still expanded because its ItemCard was never unmounted.
    expect(itemHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('topic-detail')).toBeInTheDocument();
  });
});
