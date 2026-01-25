
/**
 * Focus Persistence Types
 *
 * Type definitions for localStorage persistence of Daily Focus content.
 * These types extend the API response types with storage-specific metadata.
 *
 * @remarks
 * This module is client-side only - used with localStorage.
 * Import only from hooks or components, never from server-side code.
 *
 * @example
 * ```typescript
 * import type { StoredFocus, FocusHistory } from '@/lib/focus';
 *
 * const stored: StoredFocus = {
 *   ...focusResponse,
 *   generatedAt: now(),
 * };
 * ```
 */

import type { StatefulChallenge, StatefulGoal, StatefulTopic } from './state-machine';

// Re-export base types for convenience
export type { DailyChallenge, DailyGoal, LearningTopic } from './base-types';

/** Challenge type alias for backward compatibility */
export type { DailyChallenge as Challenge } from './base-types';

import type { DailyChallenge, DailyGoal, LearningTopic } from './base-types';

export interface FocusResponse {
  challenge: DailyChallenge;
  goal: DailyGoal;
  learningTopics: LearningTopic[];
  /**
   * Skills that may need user calibration.
   *
   * @remarks
   * Populated when the AI detects skill levels that differ from the
   * user's calibrated profile, or when new skills are detected that
   * haven't been calibrated yet.
   */
  calibrationNeeded?: CalibrationNeededItem[];
  meta: {
    generatedAt: string;
    aiEnabled: boolean;
    model: string;
    toolsUsed: string[];
    totalTimeMs: number;
    usedCachedProfile: boolean;
  };
}

/**
 * Skill calibration suggestion item.
 *
 * @remarks
 * Returned by the Focus API when the AI detects skills that may need
 * user calibration. Each item suggests a skill the user might want
 * to review and calibrate in their skill profile.
 */
export interface CalibrationNeededItem {
  /** The skill identifier (e.g., 'typescript', 'react') */
  skillId: string;
  /** Human-readable name for display */
  displayName: string;
  /**
   * Suggested skill level based on GitHub activity.
   * User can override this in their skill profile.
   */
  suggestedLevel: 'beginner' | 'intermediate' | 'advanced';
}

// =============================================================================
// Storage Types
// =============================================================================

/**
 * Validated daily record containing history of components.
 * Uses state machine for tracking item states.
 */
export interface DailyFocusRecord {
  challenges: StatefulChallenge[];
  goals: StatefulGoal[];
  learningTopics: StatefulTopic[][];
  /**
   * Skills detected that need user calibration.
   * Items are removed when confirmed or dismissed by the user.
   */
  calibrationNeeded?: CalibrationNeededItem[];
}

/**
 * History of Daily Focus records keyed by date.
 */
export type FocusHistory = Record<string, DailyFocusRecord>;

/**
 * Storage schema - history keyed by date.
 */
export interface FocusStorageSchema {
  /**
   * History of focus entries keyed by date (YYYY-MM-DD).
   */
  history: FocusHistory;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum number of history entries to retain.
 * 30 days provides sufficient history for user review.
 */
export const MAX_HISTORY_ENTRIES = 30;
