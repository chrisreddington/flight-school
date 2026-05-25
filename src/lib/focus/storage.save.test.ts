/**
 * Tests for the save paths of the focus storage façade:
 *   saveTodaysFocus (core write semantics) and saveSelfExplanation.
 *
 * History-pruning and multi-day cross-record behaviour for saveTodaysFocus
 * live in `storage.history.test.ts` so this file stays single-purpose.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FocusResponse, FocusStorageSchema, DailyChallenge, DailyGoal, LearningTopic } from './types';

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

function buildExistingDay(): FocusStorageSchema {
  return {
    history: {
      '2024-01-15': {
        challenges: [{ data: mockChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
        goals: [{ data: mockGoal, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
        learningTopics: [[{ data: mockTopic, stateHistory: [{ state: 'not-explored', timestamp: TS }] }]],
      },
    },
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

describe('focusStore.saveTodaysFocus', () => {
  it('writes a brand-new daily record when none exists', async () => {
    await focusStore.saveTodaysFocus(mockFocusResponse);

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15']).toBeDefined();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(1);
    expect(saved.history['2024-01-15'].goals).toHaveLength(1);
    expect(saved.history['2024-01-15'].learningTopics).toHaveLength(1);
  });

  it('does not duplicate identical content already stored for today', async () => {
    vi.mocked(apiGet).mockResolvedValue(buildExistingDay());

    await focusStore.saveTodaysFocus(mockFocusResponse);

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(1);
    expect(saved.history['2024-01-15'].goals).toHaveLength(1);
    expect(saved.history['2024-01-15'].learningTopics).toHaveLength(1);
  });

  it('appends a new challenge entry when content differs from history', async () => {
    vi.mocked(apiGet).mockResolvedValue(buildExistingDay());

    await focusStore.saveTodaysFocus({
      ...mockFocusResponse,
      challenge: { ...mockChallenge, title: 'Different Challenge' },
    });

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(2);
    expect(saved.history['2024-01-15'].goals).toHaveLength(1);
  });

  it('skips challenges that are missing both id and title', async () => {
    await focusStore.saveTodaysFocus({
      ...mockFocusResponse,
      challenge: { ...mockChallenge, id: '', title: '' },
    });

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(0);
    expect(saved.history['2024-01-15'].goals).toHaveLength(1);
    expect(saved.history['2024-01-15'].learningTopics).toHaveLength(1);
  });
});

describe('focusStore.saveSelfExplanation', () => {
  it('trims whitespace and persists the explanation onto the challenge', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: {
        '2024-01-15': {
          challenges: [{ data: mockChallenge, stateHistory: [{ state: 'completed', timestamp: TS }] }],
          goals: [],
          learningTopics: [],
        },
      },
    });

    await focusStore.saveSelfExplanation('2024-01-15', 'challenge', 'challenge-1', '  I learned CI pipelines.  ');

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].challenges[0].data.selfExplanation).toBe('I learned CI pipelines.');
  });

  it('persists the explanation onto the matching topic', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: {
        '2024-01-15': {
          challenges: [],
          goals: [],
          learningTopics: [[{ data: mockTopic, stateHistory: [{ state: 'explored', timestamp: TS }] }]],
        },
      },
    });

    await focusStore.saveSelfExplanation('2024-01-15', 'topic', 'topic-1', 'I should revisit GitHub workflows.');

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].learningTopics[0][0].data.selfExplanation).toBe(
      'I should revisit GitHub workflows.',
    );
  });
});
