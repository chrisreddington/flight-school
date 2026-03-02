import type { HabitWithHistory } from '@/lib/habits/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HabitCard } from './HabitCard';

const { updateMock, deleteMock, getRemainingSkipsMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  getRemainingSkipsMock: vi.fn(() => 3),
}));

vi.mock('@/lib/habits', () => ({
  habitStore: {
    update: updateMock,
    delete: deleteMock,
  },
}));

vi.mock('@/lib/habits/state-machine', () => ({
  checkInHabit: vi.fn((habit: HabitWithHistory) => habit),
  skipHabitDay: vi.fn((habit: HabitWithHistory) => habit),
  undoCheckIn: vi.fn((habit: HabitWithHistory) => habit),
  isPendingToday: vi.fn(() => true),
  getRemainingSkips: getRemainingSkipsMock,
}));

vi.mock('@primer/react', async () => {
  const actual = await vi.importActual('@primer/react');
  return {
    ...actual,
    useConfirm: () => vi.fn().mockResolvedValue(true),
  };
});

function createHabit(overrides: Partial<HabitWithHistory> = {}): HabitWithHistory {
  return {
    id: 'h1',
    title: 'Test Habit',
    description: 'desc',
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

describe('HabitCard', () => {
  it('renders habit title', () => {
    render(<HabitCard habit={createHabit()} />);
    expect(screen.getByRole('heading', { name: 'Test Habit' })).toBeInTheDocument();
  });

  it('shows actionError InlineMessage when checkIn fails', async () => {
    updateMock.mockRejectedValueOnce(new Error('Check-in failed'));

    render(<HabitCard habit={createHabit()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Done!' }));

    expect(await screen.findByText('Check-in failed')).toBeInTheDocument();
  });

  it('shows actionError InlineMessage when skip fails', async () => {
    getRemainingSkipsMock.mockReturnValueOnce(1);
    updateMock.mockRejectedValueOnce(new Error('Skip failed'));

    render(<HabitCard habit={createHabit()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip Today' }));

    expect(await screen.findByText('Skip failed')).toBeInTheDocument();
  });
});
