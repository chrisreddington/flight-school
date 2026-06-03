/**
 * Tests for multi-day / history-spanning behaviour of saveTodaysFocus:
 * calibration-item merging across writes and history-window pruning
 * when the schema exceeds MAX_HISTORY_ENTRIES.
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

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

vi.mock('@/lib/utils/date-utils', () => ({
  getDateKey: vi.fn(() => '2024-01-15'),
  isTodayDateKey: vi.fn((key: string) => key === '2024-01-15'),
  now: vi.fn(() => '2024-01-15T12:00:00.000Z'),
  nowMs: vi.fn(() => 1705320000000),
}));

const { apiGet, apiPost } = await import('@/lib/api-client');
const { getDateKey } = await import('@/lib/utils/date-utils');
const { focusStore } = await import('./storage');

const TS = '2024-01-15T12:00:00.000Z';

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
    generatedAt: TS,
    aiEnabled: true,
    model: 'gpt-4',
    toolsUsed: [],
    totalTimeMs: 1000,
    usedCachedProfile: true,
  },
};

function dayRecord(): FocusStorageSchema['history'][string] {
  return {
    challenges: [{ data: mockChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
    goals: [{ data: mockGoal, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
    learningTopics: [[{ data: mockTopic, stateHistory: [{ state: 'not-explored', timestamp: TS }] }]],
  };
}

function lastSavedSchema(): FocusStorageSchema {
  return vi.mocked(apiPost).mock.calls[0][1] as FocusStorageSchema;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.mocked(getDateKey).mockReturnValue('2024-01-15');
  vi.mocked(apiGet).mockResolvedValue({ history: {} });
  vi.mocked(apiPost).mockResolvedValue(undefined);
});

describe('focusStore.saveTodaysFocus — calibration merge', () => {
  it('merges new calibration items with existing ones without introducing duplicates', async () => {
    const existing: CalibrationNeededItem = {
      skillId: 'typescript',
      displayName: 'TypeScript',
      suggestedLevel: 'intermediate',
    };
    const fresh: CalibrationNeededItem = {
      skillId: 'react',
      displayName: 'React',
      suggestedLevel: 'advanced',
    };

    vi.mocked(apiGet).mockResolvedValue({
      history: { '2024-01-15': { ...dayRecord(), calibrationNeeded: [existing] } },
    });

    await focusStore.saveTodaysFocus({
      ...mockFocusResponse,
      calibrationNeeded: [existing, fresh],
    });

    const merged = lastSavedSchema().history['2024-01-15'].calibrationNeeded;
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual(existing);
    expect(merged).toContainEqual(fresh);
  });
});

describe('focusStore.saveTodaysFocus — history pruning', () => {
  it('prunes oldest entries when history would exceed MAX_HISTORY_ENTRIES', async () => {
    const dates = Array.from(
      { length: MAX_HISTORY_ENTRIES + 5 },
      (_, i) => `2024-01-${String(i + 1).padStart(2, '0')}`,
    );
    const history: FocusStorageSchema['history'] = {};
    for (const date of dates) {
      history[date] = dayRecord();
    }
    vi.mocked(apiGet).mockResolvedValue({ history });

    await focusStore.saveTodaysFocus(mockFocusResponse);

    const saved = lastSavedSchema();
    expect(Object.keys(saved.history).length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES);
  });
});

describe('focusStore.saveCompleteFocusResponse', () => {
  it('writes the full focus payload in one schema mutation', async () => {
    vi.mocked(apiGet).mockResolvedValue({ history: {} });

    await focusStore.saveCompleteFocusResponse({
      ...mockFocusResponse,
      meta: {
        ...mockFocusResponse.meta,
        generatedAt: '2024-01-15T14:00:00.000Z',
        toolsUsed: ['copilot'],
        skillProfileLastUpdated: '2024-01-15T13:30:00.000Z',
      },
    });

    expect(vi.mocked(apiGet).mock.calls).toHaveLength(1);
    expect(vi.mocked(apiPost).mock.calls).toHaveLength(1);

    const saved = lastSavedSchema();
    const record = saved.history['2024-01-15'];
    expect(record.challenges).toHaveLength(1);
    expect(record.goals).toHaveLength(1);
    expect(record.learningTopics).toHaveLength(1);
    expect(record.meta).toEqual({
      generatedAt: '2024-01-15T14:00:00.000Z',
      toolsUsed: ['copilot'],
      skillProfileLastUpdated: '2024-01-15T13:30:00.000Z',
    });
  });
});
