/**
 * Tests for the mutation paths of the focus storage façade:
 *   addChallenge, removeCalibrationItem, clear.
 *
 * These delegate to `storage-mutations.ts`; we mock only the HTTP seam
 * (`@/lib/api-client`) and assert on the persisted schema or thrown
 * errors — never on which collaborator was called.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FocusStorageSchema, DailyChallenge, DailyGoal, LearningTopic } from './types';

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

const { apiGet, apiPost, apiDelete } = await import('@/lib/api-client');
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

const customChallenge: DailyChallenge = {
  id: 'custom-1234567890-abc',
  title: 'Custom Challenge',
  description: 'A challenge generated on the fly',
  difficulty: 'intermediate',
  language: 'TypeScript',
  estimatedTime: '30 minutes',
  whyThisChallenge: [],
  isCustom: true,
};

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

describe('focusStore.addChallenge', () => {
  it('adds a challenge into an existing empty daily record', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: { '2024-01-15': { challenges: [], goals: [], learningTopics: [] } },
    });

    await focusStore.addChallenge('2024-01-15', customChallenge);

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(1);
    expect(saved.history['2024-01-15'].challenges[0].data.id).toBe('custom-1234567890-abc');
  });

  it('creates the daily record on the fly when one does not yet exist', async () => {
    // Simulates user opening a challenge URL directly without visiting the dashboard.
    vi.mocked(apiGet).mockResolvedValue({ history: {} });

    await focusStore.addChallenge('2024-01-15', customChallenge);

    const saved = lastSavedSchema();
    expect(saved.history['2024-01-15']).toBeDefined();
    expect(saved.history['2024-01-15'].challenges).toHaveLength(1);
  });

  it('is idempotent — does not write when the challenge already exists', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: {
        '2024-01-15': {
          challenges: [{ data: customChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
          goals: [],
          learningTopics: [],
        },
      },
    });

    await focusStore.addChallenge('2024-01-15', customChallenge);

    expect(vi.mocked(apiPost).mock.calls).toHaveLength(0);
  });

  it('rejects writes to past dates without persisting anything', async () => {
    await focusStore.addChallenge('2024-01-14', customChallenge);

    expect(vi.mocked(apiPost).mock.calls).toHaveLength(0);
  });
});

describe('focusStore.removeCalibrationItem', () => {
  it("removes the calibration item matching the supplied skillId from today's record", async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: {
        '2024-01-15': {
          challenges: [{ data: mockChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
          goals: [{ data: mockGoal, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
          learningTopics: [[{ data: mockTopic, stateHistory: [{ state: 'not-explored', timestamp: TS }] }]],
          calibrationNeeded: [
            { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
            { skillId: 'react', displayName: 'React', suggestedLevel: 'advanced' },
          ],
        },
      },
    });

    await focusStore.removeCalibrationItem('typescript');

    const remaining = lastSavedSchema().history['2024-01-15'].calibrationNeeded;
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0].skillId).toBe('react');
  });

  it('is a no-op when there is no calibration list to remove from', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      history: {
        '2024-01-15': {
          challenges: [{ data: mockChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
          goals: [{ data: mockGoal, stateHistory: [{ state: 'not-started', timestamp: TS }] }],
          learningTopics: [[{ data: mockTopic, stateHistory: [{ state: 'not-explored', timestamp: TS }] }]],
        },
      },
    });

    await focusStore.removeCalibrationItem('typescript');

    expect(vi.mocked(apiPost).mock.calls).toHaveLength(0);
  });
});

describe('focusStore.clear', () => {
  it('clears storage via the persistence DELETE route', async () => {
    vi.mocked(apiDelete).mockResolvedValue(undefined);

    await focusStore.clear();

    expect(vi.mocked(apiDelete).mock.calls).toEqual([['/api/focus/storage']]);
  });

  it('propagates errors from the underlying persistence layer', async () => {
    vi.mocked(apiDelete).mockRejectedValue(new Error('Network error'));

    await expect(focusStore.clear()).rejects.toThrow('Network error');
  });
});
