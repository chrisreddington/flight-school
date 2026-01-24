/**
 * Habit State Machine Tests
 *
 * Tests for habit check-in logic, skip management, and streak calculations.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  checkInHabit,
  skipHabitDay,
  getRemainingSkips,
  isPendingToday,
} from './state-machine';
import type { HabitWithHistory, TimeTrackingConfig, CountTrackingConfig, BinaryTrackingConfig } from './types';

// Mock date utilities
vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: () => '2026-01-24',
  now: () => '2026-01-24T12:00:00.000Z',
}));

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestHabit(overrides: Partial<HabitWithHistory> = {}): HabitWithHistory {
  return {
    id: 'habit-1',
    title: 'Test Habit',
    description: 'A test habit',
    tracking: { mode: 'binary' } as BinaryTrackingConfig,
    totalDays: 7,
    includesWeekends: true,
    allowedSkips: 1,
    createdAt: '2026-01-20T00:00:00.000Z',
    currentDay: 0,
    skipsUsed: 0,
    state: 'not-started',
    checkIns: [],
    ...overrides,
  };
}

function createTimeHabit(minMinutes: number = 30): HabitWithHistory {
  return createTestHabit({
    tracking: { mode: 'time', minMinutes } as TimeTrackingConfig,
  });
}

function createCountHabit(target: number = 3): HabitWithHistory {
  return createTestHabit({
    tracking: { mode: 'count', target, unit: 'tests' } as CountTrackingConfig,
  });
}

// =============================================================================
// checkInHabit Tests
// =============================================================================

describe('checkInHabit', () => {
  describe('binary tracking mode', () => {
    it('should complete check-in when value is true', () => {
      const habit = createTestHabit();
      const result = checkInHabit(habit, true);

      expect(result.currentDay).toBe(1);
      expect(result.state).toBe('active');
      expect(result.checkIns).toHaveLength(1);
      expect(result.checkIns[0].completed).toBe(true);
      expect(result.checkIns[0].value).toBe(true);
    });

    it('should not complete check-in when value is false', () => {
      const habit = createTestHabit();
      const result = checkInHabit(habit, false);

      expect(result.checkIns[0].completed).toBe(false);
      expect(result.checkIns[0].value).toBe(false);
    });
  });

  describe('time tracking mode', () => {
    it.each([
      { minutes: 30, minRequired: 30, expected: true },
      { minutes: 45, minRequired: 30, expected: true },
      { minutes: 29, minRequired: 30, expected: false },
      { minutes: 0, minRequired: 30, expected: false },
    ])(
      'should return completed=$expected when minutes=$minutes and minRequired=$minRequired',
      ({ minutes, minRequired, expected }) => {
        const habit = createTimeHabit(minRequired);
        const result = checkInHabit(habit, minutes);
        expect(result.checkIns[0].completed).toBe(expected);
      }
    );
  });

  describe('count tracking mode', () => {
    it.each([
      { count: 3, target: 3, expected: true },
      { count: 5, target: 3, expected: true },
      { count: 2, target: 3, expected: false },
      { count: 0, target: 3, expected: false },
    ])(
      'should return completed=$expected when count=$count and target=$target',
      ({ count, target, expected }) => {
        const habit = createCountHabit(target);
        const result = checkInHabit(habit, count);
        expect(result.checkIns[0].completed).toBe(expected);
      }
    );
  });

  describe('state transitions', () => {
    it('should transition from not-started to active on first check-in', () => {
      const habit = createTestHabit({ state: 'not-started' });
      const result = checkInHabit(habit, true);
      expect(result.state).toBe('active');
    });

    it('should remain active when already active', () => {
      const habit = createTestHabit({ state: 'active', currentDay: 1 });
      const result = checkInHabit(habit, true);
      expect(result.state).toBe('active');
    });

    it('should transition to completed when totalDays reached', () => {
      const habit = createTestHabit({ 
        state: 'active', 
        currentDay: 6, 
        totalDays: 7 
      });
      const result = checkInHabit(habit, true);
      expect(result.state).toBe('completed');
      expect(result.currentDay).toBe(7);
    });
  });

  describe('error handling', () => {
    it('should throw if already checked in for the date', () => {
      const habit = createTestHabit({
        checkIns: [{ date: '2026-01-24', value: true, completed: true, timestamp: '2026-01-24T10:00:00.000Z' }],
      });

      expect(() => checkInHabit(habit, true)).toThrow('Already checked in for 2026-01-24');
    });
  });

  describe('skip reset', () => {
    it('should reset skipsUsed to 0 on successful check-in', () => {
      const habit = createTestHabit({ skipsUsed: 1 });
      const result = checkInHabit(habit, true);
      expect(result.skipsUsed).toBe(0);
    });

    it('should not reset skipsUsed on incomplete check-in', () => {
      const habit = createTestHabit({ skipsUsed: 1 });
      const result = checkInHabit(habit, false);
      expect(result.skipsUsed).toBe(1);
    });
  });
});

// =============================================================================
// skipHabitDay Tests
// =============================================================================

describe('skipHabitDay', () => {
  it('should increment skipsUsed and currentDay', () => {
    const habit = createTestHabit({ skipsUsed: 0, currentDay: 2 });
    const result = skipHabitDay(habit);

    expect(result.skipsUsed).toBe(1);
    expect(result.currentDay).toBe(3);
  });

  it('should record a check-in with completed=false', () => {
    const habit = createTestHabit();
    const result = skipHabitDay(habit);

    expect(result.checkIns).toHaveLength(1);
    expect(result.checkIns[0].completed).toBe(false);
    expect(result.checkIns[0].value).toBe(false);
  });

  it('should throw if already checked in for the date', () => {
    const habit = createTestHabit({
      checkIns: [{ date: '2026-01-24', value: true, completed: true, timestamp: '2026-01-24T10:00:00.000Z' }],
    });

    expect(() => skipHabitDay(habit)).toThrow('Already checked in for 2026-01-24');
  });

  it('should throw if no skips remaining', () => {
    const habit = createTestHabit({ skipsUsed: 1, allowedSkips: 1 });
    expect(() => skipHabitDay(habit)).toThrow('No skips remaining');
  });

  it.each([
    { skipsUsed: 0, allowedSkips: 2, shouldThrow: false },
    { skipsUsed: 1, allowedSkips: 2, shouldThrow: false },
    { skipsUsed: 2, allowedSkips: 2, shouldThrow: true },
    { skipsUsed: 0, allowedSkips: 0, shouldThrow: true },
  ])(
    'should throw=$shouldThrow when skipsUsed=$skipsUsed and allowedSkips=$allowedSkips',
    ({ skipsUsed, allowedSkips, shouldThrow }) => {
      const habit = createTestHabit({ skipsUsed, allowedSkips });
      if (shouldThrow) {
        expect(() => skipHabitDay(habit)).toThrow();
      } else {
        expect(() => skipHabitDay(habit)).not.toThrow();
      }
    }
  );
});

// =============================================================================
// getRemainingSkips Tests
// =============================================================================

describe('getRemainingSkips', () => {
  it.each([
    { skipsUsed: 0, allowedSkips: 2, expected: 2 },
    { skipsUsed: 1, allowedSkips: 2, expected: 1 },
    { skipsUsed: 2, allowedSkips: 2, expected: 0 },
    { skipsUsed: 5, allowedSkips: 2, expected: 0 }, // Edge case: over-used
  ])(
    'should return $expected when skipsUsed=$skipsUsed and allowedSkips=$allowedSkips',
    ({ skipsUsed, allowedSkips, expected }) => {
      const habit = createTestHabit({ skipsUsed, allowedSkips });
      expect(getRemainingSkips(habit)).toBe(expected);
    }
  );
});

// =============================================================================
// isPendingToday Tests
// =============================================================================

describe('isPendingToday', () => {
  it('should return true when no check-in exists for today', () => {
    const habit = createTestHabit({ checkIns: [] });
    expect(isPendingToday(habit)).toBe(true);
  });

  it('should return false when check-in exists for today', () => {
    const habit = createTestHabit({
      checkIns: [{ date: '2026-01-24', value: true, completed: true, timestamp: '2026-01-24T10:00:00.000Z' }],
    });
    expect(isPendingToday(habit)).toBe(false);
  });

  it('should return true when check-ins exist for other dates only', () => {
    const habit = createTestHabit({
      checkIns: [{ date: '2026-01-23', value: true, completed: true, timestamp: '2026-01-23T10:00:00.000Z' }],
    });
    expect(isPendingToday(habit)).toBe(true);
  });
});
