/**
 * useCustomChallengeQueue Hook
 *
 * React hook for managing the custom challenge queue with server-side persistence.
 * Provides CRUD operations and determines the active challenge based on priority.
 *
 * @remarks
 * This hook uses the `/api/challenges/queue` API for persistence.
 * Custom challenges take priority over daily challenges.
 *
 * @example
 * ```tsx
 * function ChallengePage() {
 *   const {
 *     queue,
 *     activeChallenge,
 *     addChallenge,
 *     removeChallenge,
 *   } = useCustomChallengeQueue(dailyChallenge);
 *
 *   if (activeChallenge?.isCustom) {
 *     return <CustomBadge />;
 *   }
 * }
 * ```
 */

import type { ActiveChallengeResult } from '@/lib/challenge/custom-queue';
import {
  challengeQueueStore,
  determineActiveChallenge,
  MAX_CUSTOM_QUEUE_SIZE,
} from '@/lib/challenge/custom-queue';
import type { DailyChallenge } from '@/lib/focus/types';
import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Result type for the useCustomChallengeQueue hook.
 */
export interface UseCustomChallengeQueueResult {
  /** Current queue of custom challenges (FIFO order) */
  queue: DailyChallenge[];
  /** Number of challenges in the queue */
  queueCount: number;
  /** Whether the queue is at maximum capacity */
  isQueueFull: boolean;
  /** Maximum queue size */
  maxQueueSize: number;
  /** The active challenge (custom or daily) based on priority */
  activeChallenge: DailyChallenge | null;
  /** Source of the active challenge */
  activeSource: ActiveChallengeResult['source'];
  /** Number of remaining custom challenges */
  queueRemaining: number;
  /** Add a challenge to the queue (returns false if full) */
  addChallenge: (challenge: DailyChallenge) => Promise<boolean>;
  /** Remove a challenge by ID */
  removeChallenge: (challengeId: string) => Promise<boolean>;
  /** Move a challenge to a new position */
  reorderChallenge: (challengeId: string, newIndex: number) => Promise<boolean>;
  /** Update a challenge in the queue */
  updateChallenge: (challengeId: string, updates: Partial<DailyChallenge>) => Promise<boolean>;
  /** Complete or skip the active challenge (removes from queue) */
  advanceQueue: () => Promise<DailyChallenge | null>;
  /** Clear the entire queue */
  clearQueue: () => Promise<void>;
  /** Get a challenge by ID */
  getById: (challengeId: string) => Promise<DailyChallenge | null>;
  /** Whether the queue is loading */
  isLoading: boolean;
}

/**
 * Hook for managing the custom challenge queue.
 *
 * @param dailyChallenge - The AI-generated daily challenge (for fallback)
 * @returns Queue state and CRUD operations
 */
export function useCustomChallengeQueue(
  dailyChallenge: DailyChallenge | null
): UseCustomChallengeQueueResult {
  // State synced with server storage
  const [queue, setQueue] = useState<DailyChallenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load queue from server on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await challengeQueueStore.getAll();
        setQueue(stored);
      } catch {
        // Best effort - use empty queue
        setQueue([]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Refresh state from storage
  const refreshFromStorage = useCallback(async () => {
    const stored = await challengeQueueStore.getAll();
    setQueue(stored);
  }, []);

  // Add a challenge
  const addChallenge = useCallback(async (challenge: DailyChallenge): Promise<boolean> => {
    const result = await challengeQueueStore.addChallenge(challenge);
    if (result) {
      await refreshFromStorage();
    }
    return result;
  }, [refreshFromStorage]);

  // Remove a challenge
  const removeChallenge = useCallback(async (challengeId: string): Promise<boolean> => {
    const result = await challengeQueueStore.removeChallenge(challengeId);
    if (result) {
      await refreshFromStorage();
    }
    return result;
  }, [refreshFromStorage]);

  // Reorder a challenge
  const reorderChallenge = useCallback(
    async (challengeId: string, newIndex: number): Promise<boolean> => {
      const result = await challengeQueueStore.reorderChallenge(challengeId, newIndex);
      if (result) {
        await refreshFromStorage();
      }
      return result;
    },
    [refreshFromStorage]
  );

  // Update a challenge
  const updateChallenge = useCallback(
    async (challengeId: string, updates: Partial<DailyChallenge>): Promise<boolean> => {
      const result = await challengeQueueStore.updateChallenge(challengeId, updates);
      if (result) {
        await refreshFromStorage();
      }
      return result;
    },
    [refreshFromStorage]
  );

  // Advance queue (complete/skip active custom challenge)
  const advanceQueue = useCallback(async (): Promise<DailyChallenge | null> => {
    const popped = await challengeQueueStore.popFirst();
    if (popped) {
      await refreshFromStorage();
    }
    return popped;
  }, [refreshFromStorage]);

  // Clear the queue
  const clearQueue = useCallback(async () => {
    await challengeQueueStore.clear();
    await refreshFromStorage();
  }, [refreshFromStorage]);

  // Get by ID
  const getById = useCallback(async (challengeId: string): Promise<DailyChallenge | null> => {
    return challengeQueueStore.getById(challengeId);
  }, []);

  // Determine active challenge based on priority (memoized to prevent re-computation)
  const activeResult = useMemo(() => {
    return !isLoading
      ? determineActiveChallenge(queue, dailyChallenge)
      : { challenge: dailyChallenge, source: 'daily' as const, queueRemaining: 0 };
  }, [isLoading, queue, dailyChallenge]);

  // Memoize the return object to prevent unnecessary re-renders in consumers
  return useMemo(() => ({
    queue,
    queueCount: queue.length,
    isQueueFull: queue.length >= MAX_CUSTOM_QUEUE_SIZE,
    maxQueueSize: MAX_CUSTOM_QUEUE_SIZE,
    activeChallenge: activeResult.challenge,
    activeSource: activeResult.source,
    queueRemaining: activeResult.queueRemaining,
    addChallenge,
    removeChallenge,
    reorderChallenge,
    updateChallenge,
    advanceQueue,
    clearQueue,
    getById,
    isLoading,
  }), [
    queue,
    activeResult,
    addChallenge,
    removeChallenge,
    reorderChallenge,
    updateChallenge,
    advanceQueue,
    clearQueue,
    getById,
    isLoading,
  ]);
}
