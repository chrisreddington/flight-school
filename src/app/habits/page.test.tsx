import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { getActiveMock, getCompletedMock, getAbandonedMock, updateMock, loggerErrorMock } = vi.hoisted(() => ({
  getActiveMock: vi.fn(),
  getCompletedMock: vi.fn(),
  getAbandonedMock: vi.fn(),
  updateMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/contexts/breadcrumb-context', () => ({
  useBreadcrumb: vi.fn(),
}));

vi.mock('@/lib/habits', () => ({
  habitStore: {
    getActive: getActiveMock,
    getCompleted: getCompletedMock,
    getAbandoned: getAbandonedMock,
    update: updateMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/components/AppHeader', () => ({
  AppHeader: () => <header>Header</header>,
}));

vi.mock('@/components/ProfileNav', () => ({
  ProfileNav: () => <nav>ProfileNav</nav>,
}));

vi.mock('@/components/Habits/habit-stats-section', () => ({
  HabitStatsSection: () => <div>HabitStatsSection</div>,
}));

vi.mock('@/components/Habits/habit-list-section', () => ({
  HabitListSection: ({
    onCheckIn,
  }: {
    onCheckIn: (habit: { id: string; tracking: { mode: string }; checkIns: unknown[] }, value: boolean) => void;
  }) => (
    <div>
      <button
        onClick={() =>
          onCheckIn(
            {
              id: 'habit-1',
              title: 'Daily Practice',
              description: 'Practice',
              tracking: { mode: 'binary' },
              totalDays: 7,
              includesWeekends: false,
              allowedSkips: 1,
              createdAt: '2025-01-01T00:00:00.000Z',
              currentDay: 1,
              skipsUsed: 0,
              state: 'active',
              checkIns: [],
            },
            true
          )
        }
      >
        Mock Check In
      </button>
    </div>
  ),
}));

vi.mock('@/components/Habits/HabitCreationDialog', () => ({
  HabitCreationDialog: () => null,
}));

vi.mock('@/components/Habits/HabitEditDialog', () => ({
  HabitEditDialog: () => null,
}));

vi.mock('@primer/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@primer/react')>();
  return {
    ...actual,
    useConfirm: () => vi.fn(),
    Banner: ({
      title,
      description,
      onDismiss,
    }: {
      title: string;
      description?: string;
      onDismiss?: () => void;
    }) => (
      <div>
        <p>{title}</p>
        {description && <p>{description}</p>}
        {onDismiss && <button onClick={onDismiss}>Dismiss</button>}
      </div>
    ),
  };
});

import HabitsPage from './page';

describe('HabitsPage load errors', () => {
  it('shows an error banner when habits loading fails', async () => {
    getActiveMock.mockRejectedValueOnce(new Error('storage failed'));
    getCompletedMock.mockResolvedValueOnce([]);
    getAbandonedMock.mockResolvedValueOnce([]);

    render(<HabitsPage />);

    expect(await screen.findByText('Failed to load habits')).toBeInTheDocument();
  });
});

describe('HabitsPage action errors', () => {
  it('shows action error banner when check-in update fails', async () => {
    getActiveMock.mockResolvedValueOnce([]);
    getCompletedMock.mockResolvedValueOnce([]);
    getAbandonedMock.mockResolvedValueOnce([]);
    updateMock.mockRejectedValueOnce(new Error('Update failed'));

    render(<HabitsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mock Check In' }));

    expect(await screen.findByText('Action failed')).toBeInTheDocument();
    expect(screen.getByText('Update failed')).toBeInTheDocument();
  });

  it('dismisses action error banner', async () => {
    getActiveMock.mockResolvedValueOnce([]);
    getCompletedMock.mockResolvedValueOnce([]);
    getAbandonedMock.mockResolvedValueOnce([]);
    updateMock.mockRejectedValueOnce(new Error('Update failed'));

    render(<HabitsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mock Check In' }));
    expect(await screen.findByText('Action failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(screen.queryByText('Action failed')).not.toBeInTheDocument();
    });
  });
});
