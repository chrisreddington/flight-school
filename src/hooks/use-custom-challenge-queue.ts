/**
 * useCustomChallengeQueue Hook
 *
 * React hook for managing the custom challenge queue with localStorage persistence.
 * Provides CRUD operations and determines the active challenge based on priority.
 *
 * @remarks
 * This hook uses localStorage for persistence. It should only be used
 * in client components. Custom challenges take priority over daily challenges.
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
  customChallengeQueue,
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
  addChallenge: (challenge: DailyChallenge) => boolean;
  /** Remove a challenge by ID */
  removeChallenge: (challengeId: string) => boolean;
  /** Move a challenge to a new position */
  reorderChallenge: (challengeId: string, newIndex: number) => boolean;
  /** Update a challenge in the queue */
  updateChallenge: (challengeId: string, updates: Partial<DailyChallenge>) => boolean;
  /** Complete or skip the active challenge (removes from queue) */
  advanceQueue: () => DailyChallenge | null;
  /** Clear the entire queue */
  clearQueue: () => void;
  /** Get a challenge by ID */
  getById: (challengeId: string) => DailyChallenge | null;
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
  // State synced with localStorage
  const [queue, setQueue] = useState<DailyChallenge[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  // Sync state from localStorage on mount
  useEffect(() => {
    const loadQueue = () => {
      const stored = customChallengeQueue.getAll();
      setQueue(stored);
      setIsInitialized(true);
    };

    loadQueue();

    // Listen for storage changes from other tabs
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'flight-school-custom-queue') {
        loadQueue();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Refresh state from storage
  const refreshFromStorage = useCallback(() => {
    setQueue(customChallengeQueue.getAll());
  }, []);

  // Add a challenge
  const addChallenge = useCallback((challenge: DailyChallenge): boolean => {
    const result = customChallengeQueue.addChallenge(challenge);
    if (result) {
      refreshFromStorage();
    }
    return result;
  }, [refreshFromStorage]);

  // Remove a challenge
  const removeChallenge = useCallback((challengeId: string): boolean => {
    const result = customChallengeQueue.removeChallenge(challengeId);
    if (result) {
      refreshFromStorage();
    }
    return result;
  }, [refreshFromStorage]);

  // Reorder a challenge
  const reorderChallenge = useCallback(
    (challengeId: string, newIndex: number): boolean => {
      const result = customChallengeQueue.reorderChallenge(challengeId, newIndex);
      if (result) {
        refreshFromStorage();
      }
      return result;
    },
    [refreshFromStorage]
  );

  // Update a challenge
  const updateChallenge = useCallback(
    (challengeId: string, updates: Partial<DailyChallenge>): boolean => {
      const result = customChallengeQueue.updateChallenge(challengeId, updates);
      if (result) {
        refreshFromStorage();
      }
      return result;
    },
    [refreshFromStorage]
  );

  // Advance queue (complete/skip active custom challenge)
  const advanceQueue = useCallback((): DailyChallenge | null => {
    const popped = customChallengeQueue.popFirst();
    if (popped) {
      refreshFromStorage();
    }
    return popped;
  }, [refreshFromStorage]);

  // Clear the queue
  const clearQueue = useCallback(() => {
    customChallengeQueue.clear();
    refreshFromStorage();
  }, [refreshFromStorage]);

  // Get by ID
  const getById = useCallback((challengeId: string): DailyChallenge | null => {
    return customChallengeQueue.getById(challengeId);
  }, []);

  // Determine active challenge based on priority (memoized to prevent re-computation)
  const activeResult = useMemo(() => {
    return isInitialized
      ? determineActiveChallenge(queue, dailyChallenge)
      : { challenge: dailyChallenge, source: 'daily' as const, queueRemaining: 0 };
  }, [isInitialized, queue, dailyChallenge]);

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
  ]);
}
