import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ItemCard } from './item-card';
import type { HistoryItem } from './types';

vi.mock('@/components/FocusItem', () => ({
  ChallengeCard: () => <div data-testid="challenge-card" />,
  GoalCard: () => <div data-testid="goal-card" />,
  TopicCard: () => <div data-testid="topic-card" />,
  HabitHistoryCard: () => <div data-testid="habit-card" />,
}));

function makeTopic(status: HistoryItem['status']): HistoryItem {
  return {
    type: 'topic',
    data: { id: 'topic-1', title: 'Recursion deep dive' } as HistoryItem['data'],
    timestamp: '2024-01-01T10:00:00.000Z',
    status,
  } as HistoryItem;
}

const noop = () => {};

function renderItem(item: HistoryItem) {
  return render(<ItemCard item={item} dateKey="2024-01-01" onRefresh={noop} />);
}

describe('ItemCard auto-collapse behaviour', () => {
  it('renders an active item expanded and non-collapsible', () => {
    renderItem(makeTopic('active'));

    expect(screen.getByTestId('topic-card')).toBeVisible();
    const header = screen.getByRole('button');
    expect(header).toBeDisabled();
    expect(header).not.toHaveAttribute('aria-expanded');
  });

  it('renders a completed item collapsed by default with a title summary', () => {
    renderItem(makeTopic('completed'));

    expect(screen.queryByTestId('topic-card')).not.toBeInTheDocument();
    expect(screen.getByText('Recursion deep dive')).toBeVisible();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a skipped item collapsed by default', () => {
    renderItem(makeTopic('skipped'));

    expect(screen.queryByTestId('topic-card')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ItemCard user toggle', () => {
  it('expands a completed item when the header is clicked, then re-collapses', () => {
    renderItem(makeTopic('completed'));
    const header = screen.getByRole('button');

    fireEvent.click(header);
    expect(screen.getByTestId('topic-card')).toBeVisible();
    expect(header).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(header);
    expect(screen.queryByTestId('topic-card')).not.toBeInTheDocument();
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
