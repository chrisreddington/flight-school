import type { HabitWithHistory } from '@/lib/habits/types';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HabitsClient } from './HabitsClient';

// Breadcrumb context registers a crumb as a side-effect; stub it so the hook
// doesn't reach for a missing provider in a bare render tree.
vi.mock('@/contexts/breadcrumb-context', () => ({
  useBreadcrumb: vi.fn(),
}));

// The action hook performs storage mutations; the client only consumes its
// returned handlers, so a static stub is enough for layout-level assertions.
vi.mock('@/hooks/use-habit-actions', () => ({
  useHabitActions: vi.fn(() => ({
    actionError: null,
    dismissError: vi.fn(),
    checkIn: vi.fn(),
    skip: vi.fn(),
    undo: vi.fn(),
    stop: vi.fn(),
    remove: vi.fn(),
  })),
}));

function createHabit(overrides: Partial<HabitWithHistory> = {}): HabitWithHistory {
  return {
    id: 'habit-1',
    title: 'Daily Practice',
    description: 'Practice every day',
    tracking: { mode: 'binary' },
    totalDays: 14,
    includesWeekends: false,
    allowedSkips: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    currentDay: 3,
    skipsUsed: 0,
    state: 'active',
    checkIns: [{ date: '2025-01-01', value: true, completed: true, timestamp: '2025-01-01T12:00:00.000Z' }],
    ...overrides,
  };
}

function renderHabits(active: HabitWithHistory[] = [createHabit()]) {
  return render(<HabitsClient initialActive={active} initialCompleted={[]} initialAbandoned={[]} />);
}

describe('HabitsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "My Habits" as the page h1', () => {
    renderHabits();
    expect(screen.getByRole('heading', { level: 1, name: 'My Habits' })).toBeInTheDocument();
  });

  it('renders the check-in activity heatmap', () => {
    renderHabits();
    expect(screen.getByRole('group', { name: /check-ins in the last 30 days/i })).toBeInTheDocument();
  });

  it('summarises the current streak count from props', () => {
    renderHabits([createHabit({ id: 'a', currentDay: 3 }), createHabit({ id: 'b', currentDay: 5 })]);
    const streaksTile = screen.getByText('Streaks').closest('div');
    expect(streaksTile).not.toBeNull();
    expect(within(streaksTile as HTMLElement).getByText('2')).toBeInTheDocument();
  });
});
