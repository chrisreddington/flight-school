/**
 * Custom Challenge Queue Storage
 *
 * Provides persistent storage for user-authored custom challenges.
 * Custom challenges take priority over AI-generated daily challenges.
 *
 * @remarks
 * This module uses the `/api/challenges/queue` API route for persistence.
 * Data is stored server-side in `.data/challenge-queue.json`.
 *
 * @example
 * ```typescript
 * import { challengeQueueStore, determineActiveChallenge } from '@/lib/challenge';
 *
 * // Add a custom challenge
 * await challengeQueueStore.addChallenge(customChallenge);
 *
 * // Determine which challenge to show (custom takes priority)
 * const queue = await challengeQueueStore.getAll();
 * const active = determineActiveChallenge(queue, dailyChallenge);
 * ```
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import type { DailyChallenge } from '@/lib/focus/types';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';

const log = logger.withTag('ChallengeQueueStore');

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

/** Maximum number of challenges in the queue */
export const MAX_CUSTOM_QUEUE_SIZE = 20;

/** Default empty queue */
const DEFAULT_QUEUE: CustomChallengeQueue = {
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
// Challenge Queue Store (API-backed)
// =============================================================================

/**
 * API-backed challenge queue store.
 *
 * @remarks
 * All methods are async since they require network calls.
 * Persists data server-side via the `/api/challenges/queue` route.
 */
class ChallengeQueueStore {
  private cache: CustomChallengeQueue | null = null;

  /**
   * Gets the full queue from storage.
   */
  private async getStorage(): Promise<CustomChallengeQueue> {
    if (typeof window === 'undefined') {
      return DEFAULT_QUEUE;
    }

    try {
      const queue = await apiGet<CustomChallengeQueue>('/api/challenges/queue');
      this.cache = queue;
      return queue;
    } catch (error) {
      log.error('Failed to load challenge queue', { error });
      return this.cache ?? DEFAULT_QUEUE;
    }
  }

  /**
   * Saves the queue to storage.
   */
  private async setStorage(queue: CustomChallengeQueue): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      await apiPost<void>('/api/challenges/queue', queue);
      this.cache = queue;
    } catch (error) {
      log.error('Failed to save challenge queue', { error });
      throw error;
    }
  }

  /**
   * Gets all challenges in the queue.
   */
  async getAll(): Promise<DailyChallenge[]> {
    const queue = await this.getStorage();
    return queue.challenges;
  }

  /**
   * Gets the number of challenges in the queue.
   */
  async getCount(): Promise<number> {
    const queue = await this.getStorage();
    return queue.challenges.length;
  }

  /**
   * Checks if queue is at maximum capacity.
   */
  async isFull(): Promise<boolean> {
    const count = await this.getCount();
    return count >= MAX_CUSTOM_QUEUE_SIZE;
  }

  /**
   * Adds a challenge to the end of the queue.
   *
   * @remarks
   * Challenges are always added with `isCustom: true`.
   * Returns false if queue is full.
   */
  async addChallenge(challenge: DailyChallenge): Promise<boolean> {
    const queue = await this.getStorage();

    if (queue.challenges.length >= MAX_CUSTOM_QUEUE_SIZE) {
      return false;
    }

    const customChallenge: DailyChallenge = {
      ...challenge,
      isCustom: true,
    };

    await this.setStorage({
      challenges: [...queue.challenges, customChallenge],
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Removes a challenge from the queue by ID.
   */
  async removeChallenge(challengeId: string): Promise<boolean> {
    const queue = await this.getStorage();
    const original = queue.challenges.length;
    const updated = queue.challenges.filter(c => c.id !== challengeId);

    if (updated.length === original) {
      return false;
    }

    await this.setStorage({
      challenges: updated,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Removes and returns the first challenge (FIFO pop).
   */
  async popFirst(): Promise<DailyChallenge | null> {
    const queue = await this.getStorage();

    if (queue.challenges.length === 0) {
      return null;
    }

    const [first, ...rest] = queue.challenges;

    await this.setStorage({
      challenges: rest,
      lastUpdated: now(),
    });

    return first;
  }

  /**
   * Moves a challenge to a new position in the queue.
   */
  async reorderChallenge(challengeId: string, newIndex: number): Promise<boolean> {
    const queue = await this.getStorage();
    const currentIndex = queue.challenges.findIndex(c => c.id === challengeId);

    if (currentIndex === -1) return false;
    if (newIndex < 0 || newIndex >= queue.challenges.length) return false;
    if (currentIndex === newIndex) return true;

    const challenges = [...queue.challenges];
    const [moved] = challenges.splice(currentIndex, 1);
    challenges.splice(newIndex, 0, moved);

    await this.setStorage({
      challenges,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Updates a challenge in the queue.
   */
  async updateChallenge(
    challengeId: string,
    updates: Partial<DailyChallenge>
  ): Promise<boolean> {
    const queue = await this.getStorage();
    const index = queue.challenges.findIndex(c => c.id === challengeId);

    if (index === -1) return false;

    const challenges = [...queue.challenges];
    challenges[index] = {
      ...challenges[index],
      ...updates,
      isCustom: true,
    };

    await this.setStorage({
      challenges,
      lastUpdated: now(),
    });

    return true;
  }

  /**
   * Gets a challenge by ID.
   */
  async getById(challengeId: string): Promise<DailyChallenge | null> {
    const queue = await this.getStorage();
    return queue.challenges.find(c => c.id === challengeId) ?? null;
  }

  /**
   * Clears all challenges from the queue.
   */
  async clear(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      await apiDelete<void>('/api/challenges/queue');
      this.cache = null;
      log.debug('Challenge queue cleared');
    } catch (error) {
      log.error('Failed to clear challenge queue', { error });
      throw error;
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/** Singleton challenge queue store instance */
export const challengeQueueStore = new ChallengeQueueStore();

// =============================================================================
// Legacy Compatibility (DEPRECATED)
// =============================================================================

/**
 * @deprecated Use `challengeQueueStore` instead. This alias exists for migration.
 */
export const customChallengeQueue = {
  /** @deprecated Use `await challengeQueueStore.getAll()` */
  getAll: () => {
    log.warn('customChallengeQueue.getAll() is deprecated - use await challengeQueueStore.getAll()');
    return [] as DailyChallenge[];
  },
  /** @deprecated Use `await challengeQueueStore.getCount()` */
  getCount: () => {
    log.warn('customChallengeQueue.getCount() is deprecated');
    return 0;
  },
  /** @deprecated Use `await challengeQueueStore.isFull()` */
  isFull: () => {
    log.warn('customChallengeQueue.isFull() is deprecated');
    return false;
  },
  /** @deprecated Use `await challengeQueueStore.addChallenge()` */
  addChallenge: (challenge: DailyChallenge) => {
    log.warn('customChallengeQueue.addChallenge() is deprecated');
    void challengeQueueStore.addChallenge(challenge);
    return true;
  },
  /** @deprecated Use `await challengeQueueStore.removeChallenge()` */
  removeChallenge: (id: string) => {
    log.warn('customChallengeQueue.removeChallenge() is deprecated');
    void challengeQueueStore.removeChallenge(id);
    return true;
  },
  /** @deprecated Use `await challengeQueueStore.popFirst()` */
  popFirst: () => {
    log.warn('customChallengeQueue.popFirst() is deprecated');
    void challengeQueueStore.popFirst();
    return null;
  },
  /** @deprecated Use `await challengeQueueStore.clear()` */
  clear: () => {
    log.warn('customChallengeQueue.clear() is deprecated');
    void challengeQueueStore.clear();
  },
};
