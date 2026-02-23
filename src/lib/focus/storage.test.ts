/**
 * Tests for Focus Storage.
 *
 * Tests the focus store API-based operations, including:
 * - Saving and retrieving daily focus
 * - State machine transitions
 * - History management and pruning
 * - Calibration items
 * - Topic replacement and regeneration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  FocusResponse,
  FocusStorageSchema,
  DailyChallenge,
  DailyGoal,
  LearningTopic,
  CalibrationNeededItem,
} from './types';
import { MAX_HISTORY_ENTRIES } from './types';

// Mock modules before imports
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: vi.fn(() => '2024-01-15'),
  isTodayDateKey: vi.fn((key: string) => key === '2024-01-15'),
  now: vi.fn(() => '2024-01-15T12:00:00.000Z'),
  nowMs: vi.fn(() => 1705320000000),
}));

// Import after mocking
const { apiGet, apiPost, apiDelete } = await import('@/lib/api-client');
const { getDateKey } = await import('@/lib/utils/date-utils');
const { focusStore } = await import('./storage');

describe('Focus Storage', () => {
  const mockChallenge: DailyChallenge = {
    id: 'challenge-1',
    title: 'Build a CI Pipeline',
    description: 'Set up a CI pipeline for your project',
    difficulty: 'intermediate',
    language: 'TypeScript',
    estimatedMinutes: 30,
    tags: ['ci-cd', 'devops'],
  };

  const mockGoal: DailyGoal = {
    id: 'goal-1',
    title: 'Complete the CI challenge',
    description: 'Finish setting up the pipeline',
    category: 'technical',
    estimatedMinutes: 30,
  };

  const mockTopic: LearningTopic = {
    id: 'topic-1',
    title: 'GitHub Actions',
    description: 'Learn about GitHub Actions',
    category: 'devops',
    estimatedMinutes: 20,
    resources: [],
  };

  const mockFocusResponse: FocusResponse = {
    challenge: mockChallenge,
    goal: mockGoal,
    learningTopics: [mockTopic],
    meta: {
      generatedAt: '2024-01-15T12:00:00.000Z',
      aiEnabled: true,
      model: 'gpt-4',
      toolsUsed: [],
      totalTimeMs: 1000,
      usedCachedProfile: true,
    },
  };

  const emptySchema: FocusStorageSchema = { history: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks(); // Also reset mock implementations
    vi.mocked(getDateKey).mockReturnValue('2024-01-15');
    // Reset to empty schema by default - return a NEW object each time to avoid mutations
    vi.mocked(apiGet).mockResolvedValue({ history: {} });
  });

  // ===========================================================================
  // getTodaysFocus() tests
  // ===========================================================================

  describe('getTodaysFocus', () => {
    it('should return null when no focus saved for today', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });

      const result = await focusStore.getTodaysFocus();

      expect(result).toBeNull();
    });

    it('should reconstruct focus from stored components', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [
                  { state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' },
                ],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [
                  { state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' },
                ],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [
                    { state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' },
                  ],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result).toMatchObject({
        challenge: mockChallenge,
        goal: mockGoal,
        learningTopics: [mockTopic],
      });
    });

    it('should filter out skipped topics', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [
                    { state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' },
                    { state: 'skipped', timestamp: '2024-01-15T13:00:00.000Z' },
                  ],
                },
                {
                  data: { ...mockTopic, id: 'topic-2', title: 'Docker' },
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T13:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result?.learningTopics).toHaveLength(1);
      expect(result?.learningTopics[0].id).toBe('topic-2');
    });

    it('should filter out replaced explored topics', async () => {
      const exploredTopic = { ...mockTopic, replacedByTopicId: 'topic-2' };
      const newTopic = { ...mockTopic, id: 'topic-2', title: 'New Topic' };

      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: exploredTopic,
                  stateHistory: [
                    { state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' },
                    { state: 'explored', timestamp: '2024-01-15T13:00:00.000Z' },
                  ],
                },
                {
                  data: newTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T14:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result?.learningTopics).toHaveLength(1);
      expect(result?.learningTopics[0].id).toBe('topic-2');
    });

    it('should limit to 3 topics for dashboard', async () => {
      const topics = Array.from({ length: 5 }, (_, i) => ({
        data: { ...mockTopic, id: `topic-${i}`, title: `Topic ${i}` },
        stateHistory: [{ state: 'not-explored' as const, timestamp: '2024-01-15T12:00:00.000Z' }],
      }));

      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [topics],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result?.learningTopics).toHaveLength(3);
    });

    it('should prioritize not-explored topics over explored', async () => {
      const topics = [
        {
          data: { ...mockTopic, id: 'topic-1', title: 'Explored 1' },
          stateHistory: [
            { state: 'not-explored' as const, timestamp: '2024-01-15T12:00:00.000Z' },
            { state: 'explored' as const, timestamp: '2024-01-15T13:00:00.000Z' },
          ],
        },
        {
          data: { ...mockTopic, id: 'topic-2', title: 'Not Explored' },
          stateHistory: [{ state: 'not-explored' as const, timestamp: '2024-01-15T12:00:00.000Z' }],
        },
      ];

      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [topics],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result?.learningTopics[0].id).toBe('topic-2');
      expect(result?.learningTopics[1].id).toBe('topic-1');
    });

    it('should return null when challenges array is empty', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result).toBeNull();
    });

    it('should include calibration items', async () => {
      const calibrationItem: CalibrationNeededItem = {
        skillId: 'typescript',
        displayName: 'TypeScript',
        suggestedLevel: 'intermediate',
      };

      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
            calibrationNeeded: [calibrationItem],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getTodaysFocus();

      expect(result?.calibrationNeeded).toEqual([calibrationItem]);
    });
  });

  // ===========================================================================
  // saveTodaysFocus() tests
  // ===========================================================================

  describe('saveTodaysFocus', () => {
    it('should save new focus content', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await focusStore.saveTodaysFocus(mockFocusResponse);

      expect(apiPost).toHaveBeenCalled();
      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(savedSchema.history['2024-01-15']).toBeDefined();
      expect(savedSchema.history['2024-01-15'].challenges).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].goals).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].learningTopics).toHaveLength(1);
    });

    it('should not duplicate identical content', async () => {
      const existingSchema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(existingSchema);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await focusStore.saveTodaysFocus(mockFocusResponse);

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(savedSchema.history['2024-01-15'].challenges).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].goals).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].learningTopics).toHaveLength(1);
    });

    it('should append changed content', async () => {
      const existingSchema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(existingSchema);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const newChallenge = { ...mockChallenge, title: 'Different Challenge' };
      await focusStore.saveTodaysFocus({
        ...mockFocusResponse,
        challenge: newChallenge,
      });

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(savedSchema.history['2024-01-15'].challenges).toHaveLength(2);
      expect(savedSchema.history['2024-01-15'].goals).toHaveLength(1);
    });

    it('should skip invalid challenges without id or title', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });
      vi.mocked(apiPost).mockResolvedValue(undefined);

      const invalidChallenge = { ...mockChallenge, id: '', title: '' };
      await focusStore.saveTodaysFocus({
        ...mockFocusResponse,
        challenge: invalidChallenge,
      });

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      // Challenge should not be added due to invalid id and title
      expect(savedSchema.history['2024-01-15'].challenges).toHaveLength(0);
      // But goal and topics should still be saved
      expect(savedSchema.history['2024-01-15'].goals).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].learningTopics).toHaveLength(1);
    });

    it('should merge calibration items avoiding duplicates', async () => {
      const existingCalibration: CalibrationNeededItem = {
        skillId: 'typescript',
        displayName: 'TypeScript',
        suggestedLevel: 'intermediate',
      };
      const newCalibration: CalibrationNeededItem = {
        skillId: 'react',
        displayName: 'React',
        suggestedLevel: 'advanced',
      };

      const existingSchema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
            calibrationNeeded: [existingCalibration],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(existingSchema);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await focusStore.saveTodaysFocus({
        ...mockFocusResponse,
        calibrationNeeded: [existingCalibration, newCalibration],
      });

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(savedSchema.history['2024-01-15'].calibrationNeeded).toHaveLength(2);
      expect(savedSchema.history['2024-01-15'].calibrationNeeded).toContainEqual(existingCalibration);
      expect(savedSchema.history['2024-01-15'].calibrationNeeded).toContainEqual(newCalibration);
    });

    it('should prune history when exceeding max entries', async () => {
      const oldDates = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`);
      const history: FocusStorageSchema['history'] = {};
      oldDates.forEach((date) => {
        history[date] = {
          challenges: [
            {
              data: mockChallenge,
              stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
          ],
          goals: [
            {
              data: mockGoal,
              stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
          ],
          learningTopics: [
            [
              {
                data: mockTopic,
                stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
          ],
        };
      });

      vi.mocked(apiGet).mockResolvedValue({ history });
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await focusStore.saveTodaysFocus(mockFocusResponse);

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(Object.keys(savedSchema.history).length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES);
    });
  });

  // ===========================================================================
  // getHistory() tests
  // ===========================================================================

  describe('getHistory', () => {
    it('should return all history', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [],
            goals: [],
            learningTopics: [],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getHistory();

      expect(result).toEqual(schema.history);
    });

    it('should return empty object when no history', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });

      const result = await focusStore.getHistory();

      expect(result).toEqual({});
    });
  });

  // ===========================================================================
  // isNewDay() tests
  // ===========================================================================

  describe('isNewDay', () => {
    it('should return true when no focus for today', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });

      const result = await focusStore.isNewDay();

      expect(result).toBe(true);
    });

    it('should return false when focus exists for today', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.isNewDay();

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // clear() tests
  // ===========================================================================

  describe('clear', () => {
    it('should clear all storage', async () => {
      vi.mocked(apiDelete).mockResolvedValue(undefined);

      await focusStore.clear();

      expect(apiDelete).toHaveBeenCalledWith('/api/focus/storage');
    });

    it('should throw error when API fails', async () => {
      vi.mocked(apiDelete).mockRejectedValue(new Error('Network error'));

      await expect(focusStore.clear()).rejects.toThrow('Network error');
    });
  });

  // ===========================================================================
  // removeCalibrationItem() tests
  // ===========================================================================

  describe('removeCalibrationItem', () => {
    it('should remove calibration item by skillId', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
            calibrationNeeded: [
              { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
              { skillId: 'react', displayName: 'React', suggestedLevel: 'advanced' },
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await focusStore.removeCalibrationItem('typescript');

      const savedSchema = vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
      expect(savedSchema.history['2024-01-15'].calibrationNeeded).toHaveLength(1);
      expect(savedSchema.history['2024-01-15'].calibrationNeeded?.[0].skillId).toBe('react');
    });

    it('should handle removing from empty calibration list', async () => {
      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      await focusStore.removeCalibrationItem('typescript');

      // Should not throw
      expect(apiPost).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // getCalibrationNeeded() tests
  // ===========================================================================

  describe('getCalibrationNeeded', () => {
    it('should return calibration items for today', async () => {
      const calibrationItems: CalibrationNeededItem[] = [
        { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
      ];

      const schema: FocusStorageSchema = {
        history: {
          '2024-01-15': {
            challenges: [
              {
                data: mockChallenge,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            goals: [
              {
                data: mockGoal,
                stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T12:00:00.000Z' }],
              },
            ],
            learningTopics: [
              [
                {
                  data: mockTopic,
                  stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
                },
              ],
            ],
            calibrationNeeded: calibrationItems,
          },
        },
      };
      vi.mocked(apiGet).mockResolvedValue(schema);

      const result = await focusStore.getCalibrationNeeded();

      expect(result).toEqual(calibrationItems);
    });

    it('should return empty array when no calibration needed', async () => {
      vi.mocked(apiGet).mockResolvedValue({ history: {} });

      const result = await focusStore.getCalibrationNeeded();

      expect(result).toEqual([]);
    });
  });
});
