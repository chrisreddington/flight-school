/**
 * Habit Tracking Types
 * 
 * Type definitions for user-created habits with multi-day streak tracking.
 * Habits are distinct from daily goals - they track consistency over time.
 */

import { now } from '@/lib/utils/date-utils';

// =============================================================================
// Tracking Modes
// =============================================================================

/**
 * Configuration for time-based tracking (timer, pomodoro).
 */
export interface TimeTrackingConfig {
  mode: 'time';
  /** Minimum minutes per day */
  minMinutes: number;
  /** Optional maximum minutes per day */
  maxMinutes?: number;
}

/**
 * Configuration for count-based tracking (e.g., "3 tests/day").
 */
export interface CountTrackingConfig {
  mode: 'count';
  /** Target count per day (e.g., 3 for "3 tests/day") */
  target: number;
  /** What is being counted (e.g., "tests", "commits") */
  unit: string;
}

/**
 * Configuration for binary tracking (yes/no check-in).
 */
export interface BinaryTrackingConfig {
  mode: 'binary';
}

export type TrackingConfig = TimeTrackingConfig | CountTrackingConfig | BinaryTrackingConfig;

// =============================================================================
// Habit Definition
// =============================================================================

/**
 * User-created habit with streak tracking.
 */
export interface Habit {
  /** Unique identifier */
  id: string;
  /** Habit title (e.g., "Daily CI focus") */
  title: string;
  /** Detailed description */
  description: string;
  /** Tracking configuration */
  tracking: TrackingConfig;
  /** Total days to complete (7, 14, 21, 30) */
  totalDays: number;
  /** Whether to include weekends in streak */
  includesWeekends: boolean;
  /** Number of allowed skips before streak breaks (default: 1) */
  allowedSkips: number;
  /** ISO timestamp when habit was created */
  createdAt: string;
  /** ISO timestamp when habit started (first check-in) */
  startDate?: string;
  /** Current day number (0 = not started, 1-N = in progress) */
  currentDay: number;
  /** Number of skips used so far */
  skipsUsed: number;
  /** Current state */
  state: HabitState;
}

/**
 * Valid states for a habit.
 */
export type HabitState = 'not-started' | 'active' | 'paused' | 'completed' | 'abandoned';

// =============================================================================
// Daily Check-ins
// =============================================================================

/**
 * A single day's check-in for a habit.
 */
export interface DailyCheckIn {
  /** Date key (YYYY-MM-DD) */
  date: string;
  /** Value logged (minutes for time, count for count, true for binary) */
  value: number | boolean;
  /** Whether this check-in completed the daily requirement */
  completed: boolean;
  /** ISO timestamp when checked in */
  timestamp: string;
}

/**
 * Habit with full check-in history.
 */
export interface HabitWithHistory extends Habit {
  /** All check-ins (ordered chronologically) */
  checkIns: DailyCheckIn[];
}

// =============================================================================
// Habit Collection
// =============================================================================

/**
 * Collection of all user habits.
 */
export interface HabitCollection {
  /** All habits (active, completed, abandoned) */
  habits: HabitWithHistory[];
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum number of active habits allowed simultaneously.
 */
export const MAX_ACTIVE_HABITS = 10;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new habit with default values.
 *
 * @param title - Habit title
 * @param description - Habit description
 * @param tracking - Tracking configuration (time, count, or binary)
 * @param totalDays - Total days to complete the habit
 * @param includesWeekends - Whether weekends count toward the habit
 * @returns New habit instance with default state
 */
export function createHabit(
  title: string,
  description: string,
  tracking: TrackingConfig,
  totalDays: number,
  includesWeekends: boolean = false
): Habit {
  return {
    id: `habit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    title,
    description,
    tracking,
    totalDays,
    includesWeekends,
    allowedSkips: 1, // Default: 1 grace day
    createdAt: now(),
    currentDay: 0,
    skipsUsed: 0,
    state: 'not-started',
  };
}

/**
 * Creates a habit with history wrapper.
 *
 * @param habit - Base habit to wrap
 * @returns Habit with empty check-in history
 */
export function createHabitWithHistory(habit: Habit): HabitWithHistory {
  return {
    ...habit,
    checkIns: [],
  };
}
