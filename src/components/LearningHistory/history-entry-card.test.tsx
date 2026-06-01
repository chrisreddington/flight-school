import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryEntryCard } from './history-entry-card';
import type { HistoryEntry, HistoryItem } from './types';

vi.mock('@/components/FocusItem', () => ({
  ChallengeCard: () => <div data-testid="challenge-card" />,
  GoalCard: () => <div data-testid="goal-card" />,
  TopicCard: () => <div data-testid="topic-card" />,
  HabitHistoryCard: () => <div data-testid="habit-card" />,
}));

const noop = () => {};
const asyncNoop = async () => {};

function completedTopic(): HistoryItem {
  return {
    type: 'topic',
    data: { id: 'topic-1', title: 'Recursion deep dive' } as HistoryItem['data'],
    timestamp: '2024-01-01T10:00:00.000Z',
    status: 'completed',
  } as HistoryItem;
}

function makeEntry(): HistoryEntry {
  return {
    dateKey: '2024-01-01',
    displayDate: 'Jan 1, 2024',
    accessibleDate: 'Monday, January 1, 2024',
    items: [completedTopic()],
    totalCount: 1,
    completedCount: 1,
    skippedCount: 0,
  };
}

/**
 * Controlled wrapper that owns the day-collapse state the way the real
 * LearningHistory root does, so the test can drive the day header.
 */
function DayHarness({ entry, isToday = false }: { entry: HistoryEntry; isToday?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <HistoryEntryCard
      entry={entry}
      isToday={isToday}
      isCollapsed={collapsed}
      onToggleCollapse={() => setCollapsed((value) => !value)}
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

function getDayHeader() {
  return screen.getByRole('button', { name: /Jan 1, 2024/ });
}

describe('HistoryEntryCard day collapse', () => {
  it('labels today with "Today" while keeping the date in the accessible name', () => {
    render(<DayHarness entry={makeEntry()} isToday />);

    // The visible chip reads "Today"; the date is preserved for screen readers
    // via a visually-hidden suffix so the toggle still announces which day it is.
    const todayHeader = screen.getByRole('button', { name: /Today/ });
    expect(todayHeader).toHaveAccessibleName(/Today.*Monday, January 1, 2024/);
  });

  it('exposes the day header as a real toggle button with aria-expanded', () => {
    render(<DayHarness entry={makeEntry()} />);
    const dayHeader = getDayHeader();

    expect(dayHeader).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(dayHeader);
    expect(dayHeader).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps the day items region mounted but hidden when collapsed', () => {
    render(<DayHarness entry={makeEntry()} />);
    const dayHeader = getDayHeader();
    const controlledId = dayHeader.getAttribute('aria-controls');
    expect(controlledId).toBeTruthy();

    // Mounted and visible before collapse.
    const itemsRegion = document.getElementById(controlledId as string);
    expect(itemsRegion).toBeInTheDocument();
    expect(itemsRegion).toBeVisible();

    fireEvent.click(dayHeader);

    // Still in the document after collapse (hidden, not unmounted) — this is the
    // invariant that preserves each item's local expand state across day toggles.
    expect(document.getElementById(controlledId as string)).toBeInTheDocument();
    expect(itemsRegion).not.toBeVisible();
  });

  it('preserves a user-expanded item across a day collapse/expand cycle', () => {
    render(<DayHarness entry={makeEntry()} />);

    // The completed item auto-collapses; the user expands it explicitly.
    const itemHeader = screen.getByRole('button', { name: /Recursion deep dive/ });
    fireEvent.click(itemHeader);
    expect(screen.getByTestId('topic-card')).toBeVisible();

    // Collapsing then re-expanding the day must NOT reset the item's state.
    const dayHeader = getDayHeader();
    fireEvent.click(dayHeader);
    fireEvent.click(dayHeader);

    expect(screen.getByTestId('topic-card')).toBeVisible();
  });

  it('gives each card instance a distinct items-region id when days share a dateKey', () => {
    // Two feeds of the same day must not collide on the aria-controls target,
    // which is why the region id is salted with useId() rather than the dateKey
    // alone. Each header must point at its own, in-document region.
    render(
      <>
        <DayHarness entry={makeEntry()} />
        <DayHarness entry={makeEntry()} />
      </>,
    );

    const [firstHeader, secondHeader] = screen.getAllByRole('button', { name: /Jan 1, 2024/ });
    const firstRegionId = firstHeader.getAttribute('aria-controls') as string;
    const secondRegionId = secondHeader.getAttribute('aria-controls') as string;

    expect(firstRegionId).not.toBe(secondRegionId);
    expect(document.getElementById(firstRegionId)).toBeInTheDocument();
    expect(document.getElementById(secondRegionId)).toBeInTheDocument();
  });
});
