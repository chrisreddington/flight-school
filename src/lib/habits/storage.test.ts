/**
 * Tests for Habit Storage.
 *
 * Tests the habit store API-based CRUD operations, including:
 * - Loading and saving habits
 * - Creating, updating, deleting habits
 * - Active habit limits
 * - State filtering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HabitCollection, HabitWithHistory, Habit } from './types';
import { MAX_ACTIVE_HABITS } from './types';

// Mock the API client before importing the module
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// Import after mocking
const { apiGet, apiPost } = await import('@/lib/api-client');
const { habitStore } = await import('./storage');

describe('Habit Storage', () => {
  const mockHabit: Habit = {
    id: 'habit-1',
    title: 'Daily CI/CD Practice',
    description: 'Practice CI/CD concepts daily',
    tracking: { mode: 'time', minMinutes: 30 },
    totalDays: 21,
    includesWeekends: false,
    allowedSkips: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    currentDay: 0,
    skipsUsed: 0,
    state: 'not-started',
  };

  const mockHabitWithHistory: HabitWithHistory = {
    ...mockHabit,
    checkIns: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // load() tests
  // ===========================================================================

  describe('load', () => {
    it('should load habits from API', async () => {
      const mockCollection: HabitCollection = {
        habits: [mockHabitWithHistory],
      };
      vi.mocked(apiGet).mockResolvedValue(mockCollection);

      const result = await habitStore.load();

      expect(apiGet).toHaveBeenCalledWith('/api/habits/storage');
      expect(result).toEqual(mockCollection);
    });

    it('should return empty collection when API fails', async () => {
      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      const result = await habitStore.load();

      expect(result).toEqual({ habits: [] });
    });

    it('should handle when API returns no data', async () => {
      vi.mocked(apiGet).mockResolvedValue({ habits: [] });

      const result = await habitStore.load();

      expect(result).toEqual({ habits: [] });
    });
  });

  // ===========================================================================
  // save() tests
  // ===========================================================================

  describe('save', () => {
    it('should save habits to API', async () => {
      const mockCollection: HabitCollection = {
        habits: [mockHabitWithHistory],
      };
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await habitStore.save(mockCollection);

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', mockCollection);
    });

    it('should throw error when API fails', async () => {
      const mockCollection: HabitCollection = { habits: [] };
      vi.mocked(apiPost).mockRejectedValue(new Error('Network error'));

      await expect(habitStore.save(mockCollection)).rejects.toThrow('Network error');
    });
  });

  // ===========================================================================
  // create() tests
  // ===========================================================================

  describe('create', () => {
    it('should create a new habit', async () => {
      const emptyCollection: HabitCollection = { habits: [] };
      vi.mocked(apiGet).mockResolvedValue(emptyCollection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const result = await habitStore.create(mockHabit);

      expect(result).toMatchObject({
        ...mockHabit,
        checkIns: [],
      });
      expect(apiPost).toHaveBeenCalled();
    });

    it('should throw error when max active habits exceeded', async () => {
      const activeHabits: HabitWithHistory[] = Array.from({ length: MAX_ACTIVE_HABITS }, (_, i) => ({
        ...mockHabitWithHistory,
        id: `habit-${i}`,
        state: 'active',
      }));
      const fullCollection: HabitCollection = { habits: activeHabits };
      vi.mocked(apiGet).mockResolvedValue(fullCollection);

      await expect(habitStore.create(mockHabit)).rejects.toThrow(
        `Maximum ${MAX_ACTIVE_HABITS} active habits allowed`
      );
    });

    it('should allow creating when at limit but some are completed', async () => {
      const habits: HabitWithHistory[] = [
        ...Array.from({ length: MAX_ACTIVE_HABITS - 1 }, (_, i) => ({
          ...mockHabitWithHistory,
          id: `habit-active-${i}`,
          state: 'active' as const,
        })),
        { ...mockHabitWithHistory, id: 'habit-completed', state: 'completed' as const },
      ];
      const collection: HabitCollection = { habits };
      vi.mocked(apiGet).mockResolvedValue(collection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const result = await habitStore.create(mockHabit);

      expect(result).toMatchObject({ ...mockHabit, checkIns: [] });
    });

    it('should count paused habits toward limit', async () => {
      const pausedHabits: HabitWithHistory[] = Array.from({ length: MAX_ACTIVE_HABITS }, (_, i) => ({
        ...mockHabitWithHistory,
        id: `habit-${i}`,
        state: 'paused',
      }));
      const fullCollection: HabitCollection = { habits: pausedHabits };
      vi.mocked(apiGet).mockResolvedValue(fullCollection);

      await expect(habitStore.create(mockHabit)).rejects.toThrow(
        `Maximum ${MAX_ACTIVE_HABITS} active habits allowed`
      );
    });

    it('should count not-started habits toward limit', async () => {
      const notStartedHabits: HabitWithHistory[] = Array.from({ length: MAX_ACTIVE_HABITS }, (_, i) => ({
        ...mockHabitWithHistory,
        id: `habit-${i}`,
        state: 'not-started',
      }));
      const fullCollection: HabitCollection = { habits: notStartedHabits };
      vi.mocked(apiGet).mockResolvedValue(fullCollection);

      await expect(habitStore.create(mockHabit)).rejects.toThrow(
        `Maximum ${MAX_ACTIVE_HABITS} active habits allowed`
      );
    });
  });

  // ===========================================================================
  // update() tests
  // ===========================================================================

  describe('update', () => {
    it('should update an existing habit', async () => {
      const collection: HabitCollection = { habits: [mockHabitWithHistory] };
      vi.mocked(apiGet).mockResolvedValue(collection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const updated: HabitWithHistory = {
        ...mockHabitWithHistory,
        title: 'Updated Title',
      };

      await habitStore.update(updated);

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', {
        habits: [updated],
      });
    });

    it('should throw error when habit not found', async () => {
      const collection: HabitCollection = { habits: [] };
      vi.mocked(apiGet).mockResolvedValue(collection);

      await expect(habitStore.update(mockHabitWithHistory)).rejects.toThrow(
        `Habit ${mockHabitWithHistory.id} not found`
      );
    });

    it('should preserve other habits when updating', async () => {
      const habit2: HabitWithHistory = {
        ...mockHabitWithHistory,
        id: 'habit-2',
        title: 'Other Habit',
      };
      const collection: HabitCollection = { habits: [mockHabitWithHistory, habit2] };
      vi.mocked(apiGet).mockResolvedValue(collection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const updated: HabitWithHistory = {
        ...mockHabitWithHistory,
        title: 'Updated Title',
      };

      await habitStore.update(updated);

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', {
        habits: [updated, habit2],
      });
    });
  });

  // ===========================================================================
  // get() tests
  // ===========================================================================

  describe('get', () => {
    it('should get habit by ID', async () => {
      const collection: HabitCollection = { habits: [mockHabitWithHistory] };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.get('habit-1');

      expect(result).toEqual(mockHabitWithHistory);
    });

    it('should return null when habit not found', async () => {
      const collection: HabitCollection = { habits: [] };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.get('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // getActive() tests
  // ===========================================================================

  describe('getActive', () => {
    it('should return only active habits', async () => {
      const habits: HabitWithHistory[] = [
        { ...mockHabitWithHistory, id: 'h1', state: 'active' },
        { ...mockHabitWithHistory, id: 'h2', state: 'completed' },
        { ...mockHabitWithHistory, id: 'h3', state: 'paused' },
        { ...mockHabitWithHistory, id: 'h4', state: 'abandoned' },
        { ...mockHabitWithHistory, id: 'h5', state: 'not-started' },
      ];
      const collection: HabitCollection = { habits };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.getActive();

      expect(result).toHaveLength(3);
      expect(result.map((h) => h.id)).toEqual(['h1', 'h3', 'h5']);
    });

    it('should return empty array when no active habits', async () => {
      const habits: HabitWithHistory[] = [
        { ...mockHabitWithHistory, id: 'h1', state: 'completed' },
        { ...mockHabitWithHistory, id: 'h2', state: 'abandoned' },
      ];
      const collection: HabitCollection = { habits };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.getActive();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getCompleted() tests
  // ===========================================================================

  describe('getCompleted', () => {
    it('should return only completed habits', async () => {
      const habits: HabitWithHistory[] = [
        { ...mockHabitWithHistory, id: 'h1', state: 'completed' },
        { ...mockHabitWithHistory, id: 'h2', state: 'active' },
        { ...mockHabitWithHistory, id: 'h3', state: 'completed' },
      ];
      const collection: HabitCollection = { habits };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.getCompleted();

      expect(result).toHaveLength(2);
      expect(result.map((h) => h.id)).toEqual(['h1', 'h3']);
    });

    it('should return empty array when no completed habits', async () => {
      const collection: HabitCollection = { habits: [] };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.getCompleted();

      expect(result).toEqual([]);
    });
  });

  // ===========================================================================
  // getAbandoned() tests
  // ===========================================================================

  describe('getAbandoned', () => {
    it('should return only abandoned habits', async () => {
      const habits: HabitWithHistory[] = [
        { ...mockHabitWithHistory, id: 'h1', state: 'abandoned' },
        { ...mockHabitWithHistory, id: 'h2', state: 'active' },
        { ...mockHabitWithHistory, id: 'h3', state: 'abandoned' },
      ];
      const collection: HabitCollection = { habits };
      vi.mocked(apiGet).mockResolvedValue(collection);

      const result = await habitStore.getAbandoned();

      expect(result).toHaveLength(2);
      expect(result.map((h) => h.id)).toEqual(['h1', 'h3']);
    });
  });

  // ===========================================================================
  // delete() tests
  // ===========================================================================

  describe('delete', () => {
    it('should delete a habit by ID', async () => {
      const habit2: HabitWithHistory = { ...mockHabitWithHistory, id: 'habit-2' };
      const collection: HabitCollection = { habits: [mockHabitWithHistory, habit2] };
      vi.mocked(apiGet).mockResolvedValue(collection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await habitStore.delete('habit-1');

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', {
        habits: [habit2],
      });
    });

    it('should not throw when deleting nonexistent habit', async () => {
      const collection: HabitCollection = { habits: [mockHabitWithHistory] };
      vi.mocked(apiGet).mockResolvedValue(collection);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await habitStore.delete('nonexistent');

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', {
        habits: [mockHabitWithHistory],
      });
    });
  });

  // ===========================================================================
  // clear() tests
  // ===========================================================================

  describe('clear', () => {
    it('should clear all habits', async () => {
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await habitStore.clear();

      expect(apiPost).toHaveBeenCalledWith('/api/habits/storage', { habits: [] });
    });

    it('should throw error when API fails', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('Network error'));

      await expect(habitStore.clear()).rejects.toThrow('Network error');
    });
  });
});
