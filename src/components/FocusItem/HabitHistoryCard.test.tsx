import type { HabitWithHistory } from '@/lib/habits/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HabitHistoryCard } from './HabitHistoryCard';

const { updateMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
}));

vi.mock('@/lib/habits', () => ({
  habitStore: {
    update: updateMock,
  },
}));

vi.mock('@/lib/habits/state-machine', () => ({
  checkInHabit: (habit: HabitWithHistory) => habit,
  isPendingToday: (habit: HabitWithHistory, dateKey: string) =>
    !habit.checkIns.some((checkIn) => checkIn.date === dateKey),
  getRemainingSkips: () => 1,
  skipHabitDay: (habit: HabitWithHistory) => habit,
  undoCheckIn: (habit: HabitWithHistory) => habit,
}));

vi.mock('./habit-progress-bar', () => ({
  HabitProgressBar: () => <div>HabitProgressBar</div>,
}));

vi.mock('./habit-checkin-row', () => ({
  HabitCheckInRow: ({ onUndo }: { onUndo?: () => void }) => (
    <div>
      <span>HabitCheckInRow</span>
      {onUndo && <button onClick={onUndo}>Undo</button>}
    </div>
  ),
}));

function createHabit(overrides: Partial<HabitWithHistory> = {}): HabitWithHistory {
  return {
    id: 'habit-1',
    title: 'Daily Practice',
    description: 'Practice every day',
    tracking: { mode: 'binary' },
    totalDays: 30,
    includesWeekends: false,
    allowedSkips: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    currentDay: 1,
    skipsUsed: 0,
    state: 'active',
    checkIns: [],
    ...overrides,
  };
}

describe('HabitHistoryCard', () => {
  it('renders check-in button for today pending habit', () => {
    render(
      <HabitHistoryCard
        habit={createHabit()}
        dateKey="2025-01-02"
        isToday={true}
      />
    );

    expect(screen.getByRole('button', { name: 'Yes, Done!' })).toBeInTheDocument();
  });

  it('shows error inline message when skip action fails', async () => {
    updateMock.mockRejectedValueOnce(new Error('Skip failed'));

    render(
      <HabitHistoryCard
        habit={createHabit()}
        dateKey="2025-01-02"
        isToday={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByText('Skip failed')).toBeInTheDocument();
  });

  it('shows error inline message when undo action fails', async () => {
    updateMock.mockRejectedValueOnce(new Error('Undo failed'));

    render(
      <HabitHistoryCard
        habit={createHabit({
          checkIns: [
            {
              date: '2025-01-02',
              value: true,
              completed: true,
              timestamp: '2025-01-02T10:00:00.000Z',
            },
          ],
        })}
        dateKey="2025-01-02"
        isToday={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Undo failed')).toBeInTheDocument();
  });

  it('clears error when a new action is attempted', async () => {
    updateMock.mockRejectedValueOnce(new Error('Temporary failure'));
    let resolveSecondUpdate: (() => void) | undefined;
    const secondUpdate = new Promise<void>((resolve) => {
      resolveSecondUpdate = resolve;
    });
    updateMock.mockReturnValueOnce(secondUpdate);

    render(
      <HabitHistoryCard
        habit={createHabit()}
        dateKey="2025-01-02"
        isToday={true}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByText('Temporary failure')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => {
      expect(screen.queryByText('Temporary failure')).not.toBeInTheDocument();
    });

    resolveSecondUpdate?.();
  });
});
