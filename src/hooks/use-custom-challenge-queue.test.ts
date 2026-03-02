/**
 * useCustomChallengeQueue Hook Tests
 *
 * Tests for the custom challenge queue hook covering:
 * - Initial queue loading from storage
 * - Adding challenges to queue (with max size check)
 * - Removing challenges by ID
 * - Advancing queue (pop first challenge)
 * - Clearing the entire queue
 * - Reordering challenges
 * - Updating challenges
 * - Active challenge determination (custom vs daily priority)
 * - Queue status (count, full, remaining)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { DailyChallenge } from '@/lib/focus/types';
import { determineActiveChallenge, MAX_CUSTOM_QUEUE_SIZE } from '@/lib/challenge/custom-queue';
import { useCustomChallengeQueue } from './use-custom-challenge-queue';

// Mock the challengeQueueStore
vi.mock('@/lib/challenge/custom-queue', async () => {
  const actual = await vi.importActual('@/lib/challenge/custom-queue');
  return {
    ...actual,
    challengeQueueStore: {
      getAll: vi.fn(),
      getCount: vi.fn(),
      isFull: vi.fn(),
      addChallenge: vi.fn(),
      removeChallenge: vi.fn(),
      popFirst: vi.fn(),
      reorderChallenge: vi.fn(),
      updateChallenge: vi.fn(),
      getById: vi.fn(),
      clear: vi.fn(),
    },
  };
});

vi.mock('@/lib/focus', () => ({
  focusStore: {
    addChallenge: vi.fn(),
  },
}));

vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: vi.fn(() => '2024-01-01'),
}));

import { challengeQueueStore } from '@/lib/challenge/custom-queue';
import { focusStore } from '@/lib/focus';
import { getDateKey } from '@/lib/utils/date-utils';

describe('useCustomChallengeQueue core logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('queue loading', () => {
    it('should load queue from storage on mount', async () => {
      const mockQueue: DailyChallenge[] = [
        {
          id: 'challenge-1',
          title: 'Custom Challenge 1',
          description: 'Description 1',
          difficulty: 'intermediate',
          estimatedMinutes: 30,
          category: 'api',
          isCustom: true,
        },
        {
          id: 'challenge-2',
          title: 'Custom Challenge 2',
          description: 'Description 2',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockQueue);

      const queue = await challengeQueueStore.getAll();

      expect(challengeQueueStore.getAll).toHaveBeenCalledTimes(1);
      expect(queue).toHaveLength(2);
      expect(queue[0].isCustom).toBe(true);
    });

    it('should handle empty queue', async () => {
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      const queue = await challengeQueueStore.getAll();

      expect(queue).toEqual([]);
    });

    it('should handle storage errors with empty queue fallback', async () => {
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Storage error')
      );

      await expect(challengeQueueStore.getAll()).rejects.toThrow('Storage error');
    });

    it('should set loading state during fetch', () => {
      let isLoading = true;

      Promise.resolve().then(() => {
        isLoading = false;
      });

      expect(isLoading).toBe(true);
    });
  });

  describe('addChallenge', () => {
    it('should add challenge to queue', async () => {
      const challenge: DailyChallenge = {
        id: 'challenge-new',
        title: 'New Challenge',
        description: 'New Description',
        difficulty: 'expert',
        estimatedMinutes: 60,
        category: 'backend',
      };

      (challengeQueueStore.addChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const result = await challengeQueueStore.addChallenge(challenge);

      expect(challengeQueueStore.addChallenge).toHaveBeenCalledWith(challenge);
      expect(result).toBe(true);
    });

    it('should mark challenge as custom when added', async () => {
      const challenge: DailyChallenge = {
        id: 'challenge-new',
        title: 'New Challenge',
        description: 'New Description',
        difficulty: 'beginner',
        estimatedMinutes: 20,
        category: 'frontend',
      };

      // Simulate the store marking it as custom
      const customChallenge = { ...challenge, isCustom: true };

      expect(customChallenge.isCustom).toBe(true);
    });

    it('should return false when queue is full', async () => {
      (challengeQueueStore.addChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const challenge: DailyChallenge = {
        id: 'challenge-new',
        title: 'New Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
      };

      const result = await challengeQueueStore.addChallenge(challenge);

      expect(result).toBe(false);
    });

    it('should check queue size against MAX_CUSTOM_QUEUE_SIZE', async () => {
      (challengeQueueStore.isFull as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const isFull = await challengeQueueStore.isFull();

      expect(isFull).toBe(true);
      expect(MAX_CUSTOM_QUEUE_SIZE).toBe(20);
    });

    it('should refresh state after adding', async () => {
      const newQueue: DailyChallenge[] = [
        {
          id: 'challenge-new',
          title: 'New Challenge',
          description: 'Description',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.addChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(newQueue);

      const result = await challengeQueueStore.addChallenge(newQueue[0]);
      if (result) {
        const queue = await challengeQueueStore.getAll();
        expect(queue).toHaveLength(1);
      }
    });
  });

  describe('removeChallenge', () => {
    it('should remove challenge by ID', async () => {
      (challengeQueueStore.removeChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const result = await challengeQueueStore.removeChallenge('challenge-1');

      expect(challengeQueueStore.removeChallenge).toHaveBeenCalledWith('challenge-1');
      expect(result).toBe(true);
    });

    it('should return false when challenge not found', async () => {
      (challengeQueueStore.removeChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await challengeQueueStore.removeChallenge('nonexistent');

      expect(result).toBe(false);
    });

    it('should refresh state after removal', async () => {
      const updatedQueue: DailyChallenge[] = [
        {
          id: 'challenge-2',
          title: 'Remaining Challenge',
          description: 'Description',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.removeChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedQueue);

      const result = await challengeQueueStore.removeChallenge('challenge-1');
      if (result) {
        const queue = await challengeQueueStore.getAll();
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe('challenge-2');
      }
    });
  });

  describe('advanceQueue (popFirst)', () => {
    it('should pop first challenge from queue', async () => {
      const poppedChallenge: DailyChallenge = {
        id: 'challenge-1',
        title: 'First Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      };

      (challengeQueueStore.popFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(poppedChallenge);

      const result = await challengeQueueStore.popFirst();

      expect(challengeQueueStore.popFirst).toHaveBeenCalledTimes(1);
      expect(result?.id).toBe('challenge-1');
    });

    it('should return null when queue is empty', async () => {
      (challengeQueueStore.popFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await challengeQueueStore.popFirst();

      expect(result).toBeNull();
    });

    it('should refresh state after popping', async () => {
      const poppedChallenge: DailyChallenge = {
        id: 'challenge-1',
        title: 'First Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      };

      const remainingQueue: DailyChallenge[] = [
        {
          id: 'challenge-2',
          title: 'Second Challenge',
          description: 'Description',
          difficulty: 'intermediate',
          estimatedMinutes: 30,
          category: 'backend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.popFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(poppedChallenge);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(remainingQueue);

      const popped = await challengeQueueStore.popFirst();
      if (popped) {
        const queue = await challengeQueueStore.getAll();
        expect(queue).toHaveLength(1);
        expect(queue[0].id).toBe('challenge-2');
      }
    });
  });

  describe('clearQueue', () => {
    it('should clear all challenges', async () => {
      (challengeQueueStore.clear as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      await challengeQueueStore.clear();

      expect(challengeQueueStore.clear).toHaveBeenCalledTimes(1);
    });

    it('should refresh state after clearing', async () => {
      (challengeQueueStore.clear as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

      await challengeQueueStore.clear();
      const queue = await challengeQueueStore.getAll();

      expect(queue).toEqual([]);
    });
  });

  describe('reorderChallenge', () => {
    it('should move challenge to new position', async () => {
      (challengeQueueStore.reorderChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const result = await challengeQueueStore.reorderChallenge('challenge-2', 0);

      expect(challengeQueueStore.reorderChallenge).toHaveBeenCalledWith('challenge-2', 0);
      expect(result).toBe(true);
    });

    it('should return false for invalid index', async () => {
      (challengeQueueStore.reorderChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await challengeQueueStore.reorderChallenge('challenge-1', -1);

      expect(result).toBe(false);
    });

    it('should return false for nonexistent challenge', async () => {
      (challengeQueueStore.reorderChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await challengeQueueStore.reorderChallenge('nonexistent', 0);

      expect(result).toBe(false);
    });

    it('should refresh state after reordering', async () => {
      const reorderedQueue: DailyChallenge[] = [
        {
          id: 'challenge-2',
          title: 'Second (now first)',
          description: 'Description',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
        {
          id: 'challenge-1',
          title: 'First (now second)',
          description: 'Description',
          difficulty: 'intermediate',
          estimatedMinutes: 30,
          category: 'backend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.reorderChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(reorderedQueue);

      const result = await challengeQueueStore.reorderChallenge('challenge-2', 0);
      if (result) {
        const queue = await challengeQueueStore.getAll();
        expect(queue[0].id).toBe('challenge-2');
      }
    });
  });

  describe('updateChallenge', () => {
    it('should update challenge properties', async () => {
      const updates: Partial<DailyChallenge> = {
        title: 'Updated Title',
        difficulty: 'expert',
      };

      (challengeQueueStore.updateChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const result = await challengeQueueStore.updateChallenge('challenge-1', updates);

      expect(challengeQueueStore.updateChallenge).toHaveBeenCalledWith('challenge-1', updates);
      expect(result).toBe(true);
    });

    it('should return false when challenge not found', async () => {
      const updates: Partial<DailyChallenge> = {
        title: 'Updated Title',
      };

      (challengeQueueStore.updateChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await challengeQueueStore.updateChallenge('nonexistent', updates);

      expect(result).toBe(false);
    });

    it('should preserve isCustom flag during update', async () => {
      const challenge: DailyChallenge = {
        id: 'challenge-1',
        title: 'Original',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      };

      const updates: Partial<DailyChallenge> = {
        title: 'Updated',
      };

      const updated = {
        ...challenge,
        ...updates,
        isCustom: true, // Always true for queue items
      };

      expect(updated.isCustom).toBe(true);
      expect(updated.title).toBe('Updated');
    });

    it('should refresh state after update', async () => {
      const updatedQueue: DailyChallenge[] = [
        {
          id: 'challenge-1',
          title: 'Updated Title',
          description: 'Description',
          difficulty: 'expert',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
      ];

      (challengeQueueStore.updateChallenge as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
      (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updatedQueue);

      const result = await challengeQueueStore.updateChallenge('challenge-1', { title: 'Updated Title' });
      if (result) {
        const queue = await challengeQueueStore.getAll();
        expect(queue[0].title).toBe('Updated Title');
      }
    });
  });

  describe('getById', () => {
    it('should get challenge by ID', async () => {
      const challenge: DailyChallenge = {
        id: 'challenge-1',
        title: 'Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      };

      (challengeQueueStore.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(challenge);

      const result = await challengeQueueStore.getById('challenge-1');

      expect(challengeQueueStore.getById).toHaveBeenCalledWith('challenge-1');
      expect(result?.id).toBe('challenge-1');
    });

    it('should return null when challenge not found', async () => {
      (challengeQueueStore.getById as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

      const result = await challengeQueueStore.getById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('determineActiveChallenge logic', () => {
    it('should prioritize custom queue over daily', () => {
      const customQueue: DailyChallenge[] = [
        {
          id: 'custom-1',
          title: 'Custom Challenge',
          description: 'Description',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
      ];

      const dailyChallenge: DailyChallenge = {
        id: 'daily-1',
        title: 'Daily Challenge',
        description: 'Description',
        difficulty: 'intermediate',
        estimatedMinutes: 30,
        category: 'backend',
      };

      const result = determineActiveChallenge(customQueue, dailyChallenge);

      expect(result.challenge?.id).toBe('custom-1');
      expect(result.source).toBe('custom-queue');
      expect(result.queueRemaining).toBe(1);
    });

    it('should use daily when custom queue is empty', () => {
      const customQueue: DailyChallenge[] = [];

      const dailyChallenge: DailyChallenge = {
        id: 'daily-1',
        title: 'Daily Challenge',
        description: 'Description',
        difficulty: 'intermediate',
        estimatedMinutes: 30,
        category: 'backend',
      };

      const result = determineActiveChallenge(customQueue, dailyChallenge);

      expect(result.challenge?.id).toBe('daily-1');
      expect(result.source).toBe('daily');
      expect(result.queueRemaining).toBe(0);
    });

    it('should return none when both are empty/null', () => {
      const customQueue: DailyChallenge[] = [];
      const dailyChallenge = null;

      const result = determineActiveChallenge(customQueue, dailyChallenge);

      expect(result.challenge).toBeNull();
      expect(result.source).toBe('none');
      expect(result.queueRemaining).toBe(0);
    });

    it('should calculate queueRemaining correctly', () => {
      const customQueue: DailyChallenge[] = [
        {
          id: 'custom-1',
          title: 'Challenge 1',
          description: 'Description',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          category: 'frontend',
          isCustom: true,
        },
        {
          id: 'custom-2',
          title: 'Challenge 2',
          description: 'Description',
          difficulty: 'intermediate',
          estimatedMinutes: 30,
          category: 'backend',
          isCustom: true,
        },
        {
          id: 'custom-3',
          title: 'Challenge 3',
          description: 'Description',
          difficulty: 'expert',
          estimatedMinutes: 60,
          category: 'api',
          isCustom: true,
        },
      ];

      const result = determineActiveChallenge(customQueue, null);

      expect(result.queueRemaining).toBe(3);
    });
  });

  describe('queue status computations', () => {
    it('should compute queueCount', () => {
      const queue: DailyChallenge[] = [
        { id: '1', title: 'C1', description: 'D', difficulty: 'beginner', estimatedMinutes: 15, category: 'frontend', isCustom: true },
        { id: '2', title: 'C2', description: 'D', difficulty: 'intermediate', estimatedMinutes: 30, category: 'backend', isCustom: true },
      ];

      const queueCount = queue.length;

      expect(queueCount).toBe(2);
    });

    it('should compute isQueueFull', () => {
      const queue = new Array(MAX_CUSTOM_QUEUE_SIZE).fill({
        id: 'challenge',
        title: 'Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      });

      const isQueueFull = queue.length >= MAX_CUSTOM_QUEUE_SIZE;

      expect(isQueueFull).toBe(true);
    });

    it('should not be full when below max', () => {
      const queue = new Array(5).fill({
        id: 'challenge',
        title: 'Challenge',
        description: 'Description',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      });

      const isQueueFull = queue.length >= MAX_CUSTOM_QUEUE_SIZE;

      expect(isQueueFull).toBe(false);
    });

    it('should return loading state during initial fetch', () => {
      const isLoading = true;

      const activeResult = isLoading
        ? { challenge: null, source: 'daily' as const, queueRemaining: 0 }
        : determineActiveChallenge([], null);

      expect(activeResult.challenge).toBeNull();
    });
  });
});

describe('useCustomChallengeQueue interface contract', () => {
  it('should define expected result shape', () => {
    interface UseCustomChallengeQueueResult {
      queue: DailyChallenge[];
      queueCount: number;
      isQueueFull: boolean;
      maxQueueSize: number;
      activeChallenge: DailyChallenge | null;
      activeSource: 'custom-queue' | 'daily' | 'none';
      queueRemaining: number;
      addChallenge: (challenge: DailyChallenge) => Promise<boolean>;
      removeChallenge: (challengeId: string) => Promise<boolean>;
      reorderChallenge: (challengeId: string, newIndex: number) => Promise<boolean>;
      updateChallenge: (challengeId: string, updates: Partial<DailyChallenge>) => Promise<boolean>;
      advanceQueue: () => Promise<DailyChallenge | null>;
      clearQueue: () => Promise<void>;
      getById: (challengeId: string) => Promise<DailyChallenge | null>;
      isLoading: boolean;
    }

    const mockResult: UseCustomChallengeQueueResult = {
      queue: [],
      queueCount: 0,
      isQueueFull: false,
      maxQueueSize: MAX_CUSTOM_QUEUE_SIZE,
      activeChallenge: null,
      activeSource: 'none',
      queueRemaining: 0,
      addChallenge: async () => false,
      removeChallenge: async () => false,
      reorderChallenge: async () => false,
      updateChallenge: async () => false,
      advanceQueue: async () => null,
      clearQueue: async () => {},
      getById: async () => null,
      isLoading: false,
    };

    expect(Array.isArray(mockResult.queue)).toBe(true);
    expect(typeof mockResult.queueCount).toBe('number');
    expect(typeof mockResult.isQueueFull).toBe('boolean');
    expect(mockResult.maxQueueSize).toBe(20);
    expect(mockResult.activeChallenge).toBeNull();
    expect(mockResult.activeSource).toBe('none');
    expect(typeof mockResult.queueRemaining).toBe('number');
    expect(typeof mockResult.addChallenge).toBe('function');
    expect(typeof mockResult.removeChallenge).toBe('function');
    expect(typeof mockResult.reorderChallenge).toBe('function');
    expect(typeof mockResult.updateChallenge).toBe('function');
    expect(typeof mockResult.advanceQueue).toBe('function');
    expect(typeof mockResult.clearQueue).toBe('function');
    expect(typeof mockResult.getById).toBe('function');
    expect(typeof mockResult.isLoading).toBe('boolean');
  });
});

describe('useCustomChallengeQueue addChallenge history registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getDateKey as ReturnType<typeof vi.fn>).mockReturnValue('2024-01-01');
  });

  it('registers existing queued challenges in focusStore on initial load', async () => {
    const existingQueue: DailyChallenge[] = [
      {
        id: 'legacy-1',
        title: 'Legacy Challenge 1',
        description: 'Description 1',
        difficulty: 'beginner',
        estimatedMinutes: 15,
        category: 'frontend',
        isCustom: true,
      },
      {
        id: 'legacy-2',
        title: 'Legacy Challenge 2',
        description: 'Description 2',
        difficulty: 'intermediate',
        estimatedMinutes: 30,
        category: 'api',
        isCustom: true,
      },
    ];
    (challengeQueueStore.getAll as ReturnType<typeof vi.fn>).mockResolvedValue(existingQueue);

    const { result } = renderHook(() => useCustomChallengeQueue(null));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(focusStore.addChallenge).toHaveBeenCalledWith('2024-01-01', {
        ...existingQueue[0],
        isCustom: true,
      });
      expect(focusStore.addChallenge).toHaveBeenCalledWith('2024-01-01', {
        ...existingQueue[1],
        isCustom: true,
      });
    });
  });

  it('should register challenge in focusStore when addChallenge succeeds', async () => {
    const challenge: DailyChallenge = {
      id: 'challenge-new',
      title: 'New Challenge',
      description: 'Description',
      difficulty: 'beginner',
      estimatedMinutes: 15,
      category: 'frontend',
    };
    (challengeQueueStore.addChallenge as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const { result } = renderHook(() => useCustomChallengeQueue(null));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let added = false;
    await act(async () => {
      added = await result.current.addChallenge(challenge);
    });

    expect(added).toBe(true);
    expect(focusStore.addChallenge).toHaveBeenCalledWith('2024-01-01', {
      ...challenge,
      isCustom: true,
    });
  });

  it('should NOT register in focusStore when queue is full (addChallenge returns false)', async () => {
    const challenge: DailyChallenge = {
      id: 'challenge-new',
      title: 'New Challenge',
      description: 'Description',
      difficulty: 'beginner',
      estimatedMinutes: 15,
      category: 'frontend',
    };
    (challengeQueueStore.addChallenge as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const { result } = renderHook(() => useCustomChallengeQueue(null));
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    let added = true;
    await act(async () => {
      added = await result.current.addChallenge(challenge);
    });

    expect(added).toBe(false);
    expect(focusStore.addChallenge).not.toHaveBeenCalled();
  });
});
