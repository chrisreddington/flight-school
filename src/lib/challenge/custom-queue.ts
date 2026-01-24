/**
 * Custom Challenge Queue Storage
 *
 * Provides persistent storage for user-authored custom challenges.
 * Custom challenges take priority over AI-generated daily challenges.
 *
 * @remarks
 * This module is client-side only - uses localStorage.
 * Import only from hooks or components, never from server-side code.
 *
 * @example
 * ```typescript
 * import { customChallengeQueue, determineActiveChallenge } from '@/lib/challenge';
 *
 * // Add a custom challenge
 * customChallengeQueue.addChallenge(customChallenge);
 *
 * // Determine which challenge to show (custom takes priority)
 * const active = determineActiveChallenge(
 *   customChallengeQueue.getAll(),
 *   dailyChallenge
 * );
 * ```
 */

import type { DailyChallenge } from '@/lib/focus/types';
import { now } from '@/lib/utils/date-utils';
import { LocalStorageManager } from '@/lib/storage';

// =============================================================================
// Types
// =============================================================================

/**
 * Custom challenge queue data structure.
 */
interface CustomChallengeQueue {
  /** Ordered list of custom challenges (FIFO - first item is next to play) */
  challenges: DailyChallenge[];
  /** ISO timestamp of last queue modification */
  lastUpdated: string;
}

/**
 * Result of determining the active challenge.
 */
export interface ActiveChallengeResult {
  /** The challenge to display */
  challenge: DailyChallenge | null;
  /** Source of the challenge */
  source: 'custom-queue' | 'daily' | 'none';
  /** Remaining challenges in custom queue (0 if daily/none) */
  queueRemaining: number;
}

// =============================================================================
// Constants
// =============================================================================

/** localStorage key for custom challenge queue */
const CUSTOM_QUEUE_STORAGE_KEY = 'flight-school-custom-queue';

/** Current schema version */
const CUSTOM_QUEUE_SCHEMA_VERSION = 1;

/** Maximum number of challenges in the queue */
export const MAX_CUSTOM_QUEUE_SIZE = 20;

/** Default empty queue - internal use only */
const DEFAULT_CUSTOM_QUEUE: CustomChallengeQueue = {
  challenges: [],
  lastUpdated: '',
};

// =============================================================================
// Pure Functions
// =============================================================================

/**
 * Determines which challenge to show based on queue and daily.
 *
 * @remarks
 * Priority order:
 * 1. First challenge in custom queue (if any)
 * 2. Daily AI-generated challenge (if available)
 * 3. None
 *
 * This function is pure and testable.
 *
 * @param queue - Current custom challenge queue
 * @param daily - AI-generated daily challenge (may be null)
 * @returns Active challenge result with source information
 *
 * @example
 * ```typescript
 * const result = determineActiveChallenge(queue, daily);
 * if (result.source === 'custom-queue') \{
 *   console.log(`Custom challenge: ${result.challenge?.title}`);
 * \}
 * ```
 */
export function determineActiveChallenge(
  queue: DailyChallenge[],
  daily: DailyChallenge | null
): ActiveChallengeResult {
  // Custom queue takes priority
  if (queue.length > 0) {
    return {
      challenge: queue[0],
      source: 'custom-queue',
      queueRemaining: queue.length,
    };
  }

  // Fall back to daily challenge
  if (daily) {
    return {
      challenge: daily,
      source: 'daily',
      queueRemaining: 0,
    };
  }

  // No challenge available
  return {
    challenge: null,
    source: 'none',
    queueRemaining: 0,
  };
}

// =============================================================================
// Custom Queue Store
// =============================================================================

/**
 * localStorage manager for custom challenge queue.
 *
 * @remarks
 * Extends LocalStorageManager to provide queue-specific operations
 * including FIFO ordering, reordering, and size limits.
 */
class CustomChallengeQueueStore extends LocalStorageManager<CustomChallengeQueue> {
  constructor() {
    super({
      key: CUSTOM_QUEUE_STORAGE_KEY,
      version: CUSTOM_QUEUE_SCHEMA_VERSION,
      defaultValue: DEFAULT_CUSTOM_QUEUE,
      validate: isValidCustomQueue,
    });
  }

  /**
   * Gets all challenges in the queue.
   *
   * @returns Array of challenges in FIFO order
   */
  getAll(): DailyChallenge[] {
    return this.get().challenges;
  }

  /**
   * Gets the number of challenges in the queue.
   */
  getCount(): number {
    return this.get().challenges.length;
  }

  /**
   * Checks if queue is at maximum capacity.
   */
  isFull(): boolean {
    return this.getCount() >= MAX_CUSTOM_QUEUE_SIZE;
  }

  /**
   * Adds a challenge to the end of the queue.
   *
   * @remarks
   * Challenges are always added with `isCustom: true`.
   * Returns false if queue is full.
   *
   * @param challenge - Challenge to add
   * @returns True if added, false if queue is full
   */
  addChallenge(challenge: DailyChallenge): boolean {
    const queue = this.get();

    if (queue.challenges.length >= MAX_CUSTOM_QUEUE_SIZE) {
      return false;
    }

    // Ensure isCustom is set
    const customChallenge: DailyChallenge = {
      ...challenge,
      isCustom: true,
    };

    this.save({
      challenges: [...queue.challenges, customChallenge],
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Removes a challenge from the queue by ID.
   *
   * @param challengeId - ID of challenge to remove
   * @returns True if removed, false if not found
   */
  removeChallenge(challengeId: string): boolean {
    const queue = this.get();
    const original = queue.challenges.length;

    const updated = queue.challenges.filter(c => c.id !== challengeId);

    if (updated.length === original) {
      return false;
    }

    this.save({
      challenges: updated,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Removes and returns the first challenge (FIFO pop).
   *
   * @remarks
   * Used when completing/skipping the active custom challenge.
   *
   * @returns The removed challenge, or null if queue is empty
   */
  popFirst(): DailyChallenge | null {
    const queue = this.get();

    if (queue.challenges.length === 0) {
      return null;
    }

    const [first, ...rest] = queue.challenges;

    this.save({
      challenges: rest,
      lastUpdated: now(),
    });

    return first;
  }

  /**
   * Moves a challenge to a new position in the queue.
   *
   * @param challengeId - ID of challenge to move
   * @param newIndex - Target index (0-based)
   * @returns True if moved, false if not found or invalid index
   */
  reorderChallenge(challengeId: string, newIndex: number): boolean {
    const queue = this.get();
    const currentIndex = queue.challenges.findIndex(c => c.id === challengeId);

    if (currentIndex === -1) {
      return false;
    }

    if (newIndex < 0 || newIndex >= queue.challenges.length) {
      return false;
    }

    if (currentIndex === newIndex) {
      return true; // No change needed
    }

    // Remove from current position
    const challenges = [...queue.challenges];
    const [moved] = challenges.splice(currentIndex, 1);

    // Insert at new position
    challenges.splice(newIndex, 0, moved);

    this.save({
      challenges,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Updates a challenge in the queue.
   *
   * @param challengeId - ID of challenge to update
   * @param updates - Partial challenge updates
   * @returns True if updated, false if not found
   */
  updateChallenge(
    challengeId: string,
    updates: Partial<DailyChallenge>
  ): boolean {
    const queue = this.get();
    const index = queue.challenges.findIndex(c => c.id === challengeId);

    if (index === -1) {
      return false;
    }

    const challenges = [...queue.challenges];
    challenges[index] = {
      ...challenges[index],
      ...updates,
      isCustom: true, // Always preserve custom flag
    };

    this.save({
      challenges,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Gets a challenge by ID.
   *
   * @param challengeId - ID to find
   * @returns Challenge if found, null otherwise
   */
  getById(challengeId: string): DailyChallenge | null {
    const queue = this.get();
    return queue.challenges.find(c => c.id === challengeId) ?? null;
  }
}

// =============================================================================
// Validation
// =============================================================================

/** Validates custom queue data structure. */
function isValidCustomQueue(data: unknown): data is CustomChallengeQueue {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const queue = data as CustomChallengeQueue;

  if (!Array.isArray(queue.challenges)) {
    return false;
  }

  if (typeof queue.lastUpdated !== 'string') {
    return false;
  }

  // Validate each challenge has required fields
  for (const challenge of queue.challenges) {
    if (!isValidCustomChallenge(challenge)) {
      return false;
    }
  }

  return true;
}

/** Validates a challenge has minimum required fields. */
function isValidCustomChallenge(data: unknown): data is DailyChallenge {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const challenge = data as DailyChallenge;

  // Required string fields
  if (typeof challenge.id !== 'string' || challenge.id.length === 0) {
    return false;
  }
  if (typeof challenge.title !== 'string') {
    return false;
  }
  if (typeof challenge.description !== 'string') {
    return false;
  }
  if (typeof challenge.language !== 'string') {
    return false;
  }

  // Validate difficulty
  const validDifficulties = ['beginner', 'intermediate', 'advanced'];
  if (!validDifficulties.includes(challenge.difficulty)) {
    return false;
  }

  return true;
}

// =============================================================================
// Singleton Instance
// =============================================================================

/**
 * Singleton custom challenge queue instance.
 *
 * @remarks
 * Use this for all custom queue persistence operations.
 */
export const customChallengeQueue = new CustomChallengeQueueStore();
