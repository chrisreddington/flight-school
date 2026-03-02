import type { HabitWithHistory } from '@/lib/habits/types';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HabitListSection } from './habit-list-section';

const noop = vi.fn();

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
    currentDay: 0,
    skipsUsed: 0,
    state: 'not-started',
    checkIns: [],
    ...overrides,
  };
}

function renderSection(activeHabit: HabitWithHistory): string {
  return renderToStaticMarkup(
    <HabitListSection
      activeHabits={[activeHabit]}
      completedHabits={[]}
      abandonedHabits={[]}
      onCheckIn={noop}
      onSkip={noop}
      onUndo={noop}
      onEdit={noop}
      onStop={noop}
      onDelete={noop}
      onNewHabitClick={noop}
    />
  );
}

describe('HabitListSection habit metadata', () => {
  it('does not render day counter when currentDay is 0', () => {
    const markup = renderSection(createHabit({ currentDay: 0 }));
    expect(markup).not.toContain('Day 0/14');
  });

  it('renders day counter when currentDay is greater than 0', () => {
    const markup = renderSection(createHabit({ currentDay: 3 }));
    expect(markup).toContain('Day 3/14');
  });

  it('does not show skips badge when state is not-started', () => {
    const markup = renderSection(
      createHabit({ state: 'not-started', allowedSkips: 2, skipsUsed: 0 })
    );
    expect(markup).not.toContain('skips left');
  });

  it('shows skips badge when state is active and allowedSkips is greater than 0', () => {
    const markup = renderSection(
      createHabit({ state: 'active', allowedSkips: 2, skipsUsed: 0 })
    );
    expect(markup).toContain('2 skips left');
  });
});
