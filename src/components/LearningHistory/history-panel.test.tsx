import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './history-panel';
import type { HistoryEntry } from './types';

vi.mock('./generating-banner', () => ({
  GeneratingBanner: () => <div data-testid="generating-banner" />,
}));

// Mock the panel's actual child (HistoryTimeline), not the grandchild card, so
// these tests verify the panel -> timeline prop contract directly and stay
// insulated from the timeline's internal composition.
vi.mock('./history-timeline', () => ({
  HistoryTimeline: ({
    entries,
    todayDateKey,
    collapsedDays,
  }: {
    entries: HistoryEntry[];
    todayDateKey: string;
    collapsedDays: Set<string>;
  }) => (
    <div data-testid="history-timeline" data-today={todayDateKey}>
      {entries.map((entry) => (
        <div
          key={entry.dateKey}
          data-testid="history-entry"
          data-date={entry.dateKey}
          data-collapsed={String(collapsedDays.has(entry.dateKey))}
        />
      ))}
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

function renderPanel(overrides: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const noop = () => {};
  const asyncNoop = async () => {};
  const defaults: Parameters<typeof HistoryPanel>[0] = {
    loadError: null,
    isLoading: false,
    selectedDate: null,
    onClearSelectedDate: noop,
    hasGenerating: false,
    activeTopicIds: new Set(),
    activeChallengeIds: new Set(),
    activeGoalIds: new Set(),
    filteredEntries: [],
    todayDateKey: '2024-01-01',
    collapsedDays: new Set(),
    onToggleDayCollapse: noop,
    onRefresh: noop,
    onSkipTopic: asyncNoop,
    onSkipChallenge: asyncNoop,
    onSkipGoal: asyncNoop,
    onStopSkipTopic: noop,
    onStopSkipChallenge: noop,
    onStopSkipGoal: noop,
    onExploreTopic: asyncNoop,
    skippingTopicIds: new Set(),
    skippingChallengeIds: new Set(),
    skippingGoalIds: new Set(),
    searchQuery: '',
  };
  return render(<HistoryPanel {...defaults} {...overrides} />);
}

describe('HistoryPanel states', () => {
  it('shows a loading spinner while history is loading', () => {
    renderPanel({ isLoading: true });
    expect(screen.getByText('Loading history...')).toBeVisible();
  });

  it('shows a critical banner when loading failed', () => {
    renderPanel({ loadError: 'storage failed' });
    expect(screen.getByText('Failed to load history')).toBeVisible();
  });

  it('renders one entry per filtered day', () => {
    renderPanel({ filteredEntries: [makeEntry('2024-01-01'), makeEntry('2024-01-02')] });
    expect(screen.getAllByTestId('history-entry')).toHaveLength(2);
  });

  it('forwards todayDateKey and per-day collapse state to the timeline', () => {
    renderPanel({
      filteredEntries: [makeEntry('2024-01-01'), makeEntry('2024-01-02')],
      todayDateKey: '2024-01-02',
      collapsedDays: new Set(['2024-01-01']),
    });

    expect(screen.getByTestId('history-timeline')).toHaveAttribute('data-today', '2024-01-02');
    const [firstDay, secondDay] = screen.getAllByTestId('history-entry');
    expect(firstDay).toHaveAttribute('data-collapsed', 'true');
    expect(secondDay).toHaveAttribute('data-collapsed', 'false');
  });

  it('renders a Blankslate when there are no entries and nothing generating', () => {
    renderPanel({ filteredEntries: [] });
    expect(screen.getByText('No results')).toBeVisible();
  });

  it('does not render the Blankslate while items are generating', () => {
    renderPanel({ filteredEntries: [], hasGenerating: true });
    expect(screen.queryByText('No results')).not.toBeInTheDocument();
    expect(screen.getByTestId('generating-banner')).toBeVisible();
  });

  it('shows the selected-date banner and clears it via "Show all"', () => {
    function ClearableHarness() {
      const [selectedDate, setSelectedDate] = useState<string | null>('2024-01-01');
      const noop = () => {};
      const asyncNoop = async () => {};
      return (
        <HistoryPanel
          loadError={null}
          isLoading={false}
          selectedDate={selectedDate}
          onClearSelectedDate={() => setSelectedDate(null)}
          hasGenerating={false}
          activeTopicIds={new Set()}
          activeChallengeIds={new Set()}
          activeGoalIds={new Set()}
          filteredEntries={[]}
          todayDateKey="2024-01-01"
          collapsedDays={new Set()}
          onToggleDayCollapse={noop}
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
          searchQuery=""
        />
      );
    }

    render(<ClearableHarness />);
    expect(screen.getByText(/Showing:/)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    expect(screen.queryByText(/Showing:/)).not.toBeInTheDocument();
  });
});
