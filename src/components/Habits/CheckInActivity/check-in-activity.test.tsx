import type { DailyCheckIn, HabitWithHistory } from '@/lib/habits/types';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckInActivity } from './index';
import styles from './check-in-activity.module.css';

function createCheckIn(date: string, completed: boolean): DailyCheckIn {
  return {
    date,
    value: true,
    completed,
    timestamp: `${date}T12:00:00.000Z`,
  };
}

function createHabitWithHistory(id: string, checkIns: DailyCheckIn[]): HabitWithHistory {
  return {
    id,
    title: `Habit ${id}`,
    description: 'Practice consistently',
    tracking: { mode: 'binary' },
    totalDays: 30,
    includesWeekends: true,
    allowedSkips: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    currentDay: checkIns.length,
    skipsUsed: 0,
    state: 'active',
    checkIns,
  };
}

describe('CheckInActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('summarizes completed check-ins for assistive technology', () => {
    const habits = [
      createHabitWithHistory('one', [createCheckIn('2026-05-29', true)]),
      createHabitWithHistory('two', [createCheckIn('2026-05-28', true)]),
    ];

    render(<CheckInActivity habits={habits} />);

    expect(screen.getByRole('img', { name: '2 check-ins in the last 30 days' })).toBeInTheDocument();
  });

  it('marks days with completed check-ins using intensity levels', () => {
    const habits = [
      createHabitWithHistory('one', [createCheckIn('2026-05-29', true), createCheckIn('2026-05-27', true)]),
      createHabitWithHistory('two', [createCheckIn('2026-05-29', true)]),
      createHabitWithHistory('three', [createCheckIn('2026-05-29', true)]),
      createHabitWithHistory('four', [createCheckIn('2026-05-29', true)]),
    ];

    render(<CheckInActivity habits={habits} />);

    expect(screen.getByTitle('2026-05-27: 1 check-in')).toHaveClass(styles.level1);
    expect(screen.getByTitle('2026-05-29: 4 check-ins')).toHaveClass(styles.level4);
  });

  it('excludes completed check-ins outside the activity window', () => {
    const habits = [
      createHabitWithHistory('one', [createCheckIn('2026-04-19', true), createCheckIn('2026-05-29', true)]),
    ];

    render(<CheckInActivity habits={habits} />);

    expect(screen.getByRole('img', { name: '1 check-ins in the last 30 days' })).toBeInTheDocument();
    expect(screen.queryByTitle('2026-04-19: 1 check-in')).not.toBeInTheDocument();
  });

  it('excludes check-ins that did not complete the habit', () => {
    const habits = [createHabitWithHistory('one', [createCheckIn('2026-05-29', false)])];

    render(<CheckInActivity habits={habits} />);

    expect(screen.getByRole('img', { name: '0 check-ins in the last 30 days' })).toBeInTheDocument();
    expect(screen.getByTitle('2026-05-29: 0 check-ins')).toHaveClass(styles.level0);
  });

  it('renders an empty activity grid when there are no habits', () => {
    render(<CheckInActivity habits={[]} />);

    expect(screen.getByText('No check-ins yet — complete a habit to start your streak.')).toBeInTheDocument();
    expect(screen.getAllByTitle(/2026-\d{2}-\d{2}: 0 check-ins/u)).toHaveLength(30);
  });

  it('uses the custom day window when provided', () => {
    render(<CheckInActivity habits={[]} days={14} />);

    expect(screen.getByText('Last 14 days')).toBeInTheDocument();
    expect(screen.getAllByTitle(/2026-\d{2}-\d{2}: 0 check-ins/u)).toHaveLength(14);
  });
});
