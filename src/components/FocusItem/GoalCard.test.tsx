import type { DailyGoal } from '@/lib/focus/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GoalCard } from './GoalCard';

const { getHistoryMock, transitionGoalMock } = vi.hoisted(() => ({
  getHistoryMock: vi.fn(),
  transitionGoalMock: vi.fn(),
}));

vi.mock('@/lib/focus', () => ({
  focusStore: {
    getHistory: getHistoryMock,
    transitionGoal: transitionGoalMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

function createGoal(overrides: Partial<DailyGoal> = {}): DailyGoal {
  return {
    id: 'goal-1',
    title: 'Ship feature',
    description: 'Implement user-facing feature',
    ...overrides,
  };
}

describe('GoalCard', () => {
  it('renders goal title and description', async () => {
    getHistoryMock.mockResolvedValueOnce({});

    render(
      <GoalCard
        goal={createGoal()}
        dateKey="2025-01-02"
        showHistoryActions={true}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Ship feature' })).toBeInTheDocument();
    expect(screen.getByText('Implement user-facing feature')).toBeInTheDocument();
  });

  it('shows action failed message when mark complete fails', async () => {
    getHistoryMock.mockResolvedValueOnce({});
    transitionGoalMock.mockRejectedValueOnce('failure');

    render(
      <GoalCard
        goal={createGoal()}
        dateKey="2025-01-02"
        showHistoryActions={true}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Complete' }));

    expect(await screen.findByText('Action failed. Please try again.')).toBeInTheDocument();
  });

  it('clears error when a second action attempt is made', async () => {
    getHistoryMock.mockResolvedValueOnce({});
    transitionGoalMock.mockRejectedValueOnce('failure');
    let resolveSecondAttempt: (() => void) | undefined;
    const secondAttempt = new Promise<void>((resolve) => {
      resolveSecondAttempt = resolve;
    });
    transitionGoalMock.mockReturnValueOnce(secondAttempt);

    render(
      <GoalCard
        goal={createGoal()}
        dateKey="2025-01-02"
        showHistoryActions={true}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Complete' }));
    expect(await screen.findByText('Action failed. Please try again.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mark Complete' }));
    await waitFor(() => {
      expect(screen.queryByText('Action failed. Please try again.')).not.toBeInTheDocument();
    });

    resolveSecondAttempt?.();
  });
});
