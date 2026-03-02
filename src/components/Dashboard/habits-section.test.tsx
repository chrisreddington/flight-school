import type { HabitWithHistory } from '@/lib/habits/types';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { HabitsSection } from './habits-section';

const { getActiveMock, loggerErrorMock } = vi.hoisted(() => ({
  getActiveMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/lib/habits', () => ({
  habitStore: {
    getActive: getActiveMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: loggerErrorMock,
  },
}));

vi.mock('@/components/FocusItem/HabitCard', () => ({
  HabitCard: ({ habit }: { habit: HabitWithHistory }) => <div>{habit.title}</div>,
}));

vi.mock('@/components/Habits/HabitCreationDialog', () => ({
  HabitCreationDialog: () => null,
}));

function createHabit(overrides: Partial<HabitWithHistory> = {}): HabitWithHistory {
  return {
    id: 'habit-1',
    title: 'Daily CI Focus',
    description: 'Spend 20 minutes improving tests',
    tracking: { mode: 'binary' },
    totalDays: 14,
    includesWeekends: true,
    allowedSkips: 1,
    createdAt: '2025-01-01T00:00:00.000Z',
    currentDay: 1,
    skipsUsed: 0,
    state: 'active',
    checkIns: [],
    ...overrides,
  };
}

describe('HabitsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders an error banner when habits fail to load', async () => {
    getActiveMock.mockRejectedValueOnce(new Error('load failed'));

    render(<HabitsSection />);

    expect(await screen.findByText('Failed to load habits')).toBeInTheDocument();
  });

  it('shows loading text while loading and hides it after load completes', async () => {
    let resolveLoad: ((value: HabitWithHistory[]) => void) | undefined;
    const loadingPromise = new Promise<HabitWithHistory[]>((resolve) => {
      resolveLoad = resolve;
    });
    getActiveMock.mockReturnValueOnce(loadingPromise);

    render(<HabitsSection />);

    expect(screen.getByText('Loading habits...')).toBeInTheDocument();

    resolveLoad?.([createHabit()]);

    await waitFor(() => {
      expect(screen.queryByText('Loading habits...')).not.toBeInTheDocument();
    });
  });

  it('renders habit cards when habits load successfully', async () => {
    getActiveMock.mockResolvedValueOnce([createHabit({ title: 'Review PRs' })]);

    render(<HabitsSection />);

    expect(await screen.findByText('Review PRs')).toBeInTheDocument();
  });
});
