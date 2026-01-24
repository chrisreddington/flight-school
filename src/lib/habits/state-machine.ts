/**
 * Habit State Machine
 * 
 * State transitions and business logic for habit tracking.
 * Handles check-ins, skip management, and streak calculations.
 */

import { getDateKey, now } from '@/lib/utils/date-utils';
import type {
  DailyCheckIn,
  Habit,
  HabitState,
  HabitWithHistory,
  TimeTrackingConfig,
  CountTrackingConfig,
} from './types';

// =============================================================================
// Check-in Logic
// =============================================================================

/**
 * Checks if a value meets the tracking requirement.
 */
function meetsRequirement(habit: Habit, value: number | boolean): boolean {
  switch (habit.tracking.mode) {
    case 'time': {
      const config = habit.tracking as TimeTrackingConfig;
      return typeof value === 'number' && value >= config.minMinutes;
    }
    case 'count': {
      const config = habit.tracking as CountTrackingConfig;
      return typeof value === 'number' && value >= config.target;
    }
    case 'binary': {
      return value === true;
    }
  }
}

/**
 * Records a daily check-in for a habit.
 * 
 * @param habit - The habit to check in
 * @param value - Value for today (minutes, count, or true/false)
 * @param dateKey - Optional date key (defaults to today)
 * @returns Updated habit with new check-in
 */
export function checkInHabit(
  habit: HabitWithHistory,
  value: number | boolean,
  dateKey: string = getDateKey()
): HabitWithHistory {
  // Check if already checked in today
  const existingCheckIn = habit.checkIns.find(c => c.date === dateKey);
  if (existingCheckIn) {
    throw new Error(`Already checked in for ${dateKey}`);
  }

  const completed = meetsRequirement(habit, value);

  const checkIn: DailyCheckIn = {
    date: dateKey,
    value,
    completed,
    timestamp: now(),
  };

  // Update habit state
  const newState: HabitState = habit.state === 'not-started' ? 'active' : habit.state;
  const newCurrentDay = habit.currentDay + 1;
  const startDate = habit.startDate || now();

  // Reset skips counter if successful check-in
  const skipsUsed = completed ? 0 : habit.skipsUsed;

  // Check if habit is complete
  const isComplete = newCurrentDay >= habit.totalDays;
  const finalState: HabitState = isComplete ? 'completed' : newState;

  return {
    ...habit,
    state: finalState,
    currentDay: newCurrentDay,
    startDate,
    skipsUsed,
    checkIns: [...habit.checkIns, checkIn],
  };
}

/**
 * Skips today's check-in.
 * 
 * @param habit - The habit to skip
 * @param dateKey - Optional date key (defaults to today)
 * @returns Updated habit with skip recorded
 * 
 * @throws {Error} If no skips remaining
 */
export function skipHabitDay(
  habit: HabitWithHistory,
  dateKey: string = getDateKey()
): HabitWithHistory {
  // Check if already checked in/skipped today
  const existingCheckIn = habit.checkIns.find(c => c.date === dateKey);
  if (existingCheckIn) {
    throw new Error(`Already checked in for ${dateKey}`);
  }

  // Check if skips remaining
  if (habit.skipsUsed >= habit.allowedSkips) {
    throw new Error('No skips remaining - habit streak will break');
  }

  const checkIn: DailyCheckIn = {
    date: dateKey,
    value: false,
    completed: false,
    timestamp: now(),
  };

  const newSkipsUsed = habit.skipsUsed + 1;
  const newCurrentDay = habit.currentDay + 1;

  return {
    ...habit,
    currentDay: newCurrentDay,
    skipsUsed: newSkipsUsed,
    checkIns: [...habit.checkIns, checkIn],
  };
}

// =============================================================================
// Streak Calculations
// =============================================================================

/**
 * Gets remaining skips before streak breaks.
 *
 * @param habit - The habit to check
 * @returns Number of skips remaining (minimum 0)
 */
export function getRemainingSkips(habit: Habit): number {
  return Math.max(0, habit.allowedSkips - habit.skipsUsed);
}

/**
 * Checks if today's check-in is still pending.
 *
 * @param habit - The habit with check-in history
 * @param dateKey - Date to check (defaults to today)
 * @returns True if no check-in exists for the date
 */
export function isPendingToday(habit: HabitWithHistory, dateKey: string = getDateKey()): boolean {
  return !habit.checkIns.some(c => c.date === dateKey);
}
