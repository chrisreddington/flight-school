/**
 * Tests for the read paths of the focus storage façade:
 *   getTodaysFocus, getHistory, isNewDay, getCalibrationNeeded.
 *
 * Mocks are restricted to system seams (`@/lib/api-client` — the HTTP
 * boundary used by `persistence.ts`, plus the date utilities).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  FocusStorageSchema,
  DailyChallenge,
  DailyGoal,
  LearningTopic,
  CalibrationNeededItem,
} from './types';

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

const { apiGet } = await import('@/lib/api-client');
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

/**
 * Build a single-day FocusStorageSchema with the supplied topic groups.
 * Defaults provide a one-challenge / one-goal day at '2024-01-15'.
 */
function buildSchema(opts: {
  topicGroups?: Array<
    Array<{ data: LearningTopic; stateHistory: Array<{ state: string; timestamp: string }> }>
  >;
  challenges?: FocusStorageSchema['history'][string]['challenges'];
  goals?: FocusStorageSchema['history'][string]['goals'];
  calibrationNeeded?: CalibrationNeededItem[];
} = {}): FocusStorageSchema {
  return {
    history: {
      '2024-01-15': {
        challenges: opts.challenges ?? [
          { data: mockChallenge, stateHistory: [{ state: 'not-started', timestamp: TS }] },
        ],
        goals: opts.goals ?? [
          { data: mockGoal, stateHistory: [{ state: 'not-started', timestamp: TS }] },
        ],
        learningTopics:
          opts.topicGroups ??
          [[{ data: mockTopic, stateHistory: [{ state: 'not-explored', timestamp: TS }] }]],
        ...(opts.calibrationNeeded ? { calibrationNeeded: opts.calibrationNeeded } : {}),
      },
    },
  } as FocusStorageSchema;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();
  vi.mocked(getDateKey).mockReturnValue('2024-01-15');
  vi.mocked(apiGet).mockResolvedValue({ history: {} });
});

describe('focusStore.getTodaysFocus', () => {
  it('returns null when no focus is saved for today', async () => {
    vi.mocked(apiGet).mockResolvedValue({ history: {} });
    expect(await focusStore.getTodaysFocus()).toBeNull();
  });

  it('returns null when the challenges array for today is empty', async () => {
    vi.mocked(apiGet).mockResolvedValue(buildSchema({ challenges: [] }));
    expect(await focusStore.getTodaysFocus()).toBeNull();
  });

  it('reconstructs focus from stored components', async () => {
    vi.mocked(apiGet).mockResolvedValue(buildSchema());
    const result = await focusStore.getTodaysFocus();
    expect(result).toMatchObject({
      challenge: mockChallenge,
      goal: mockGoal,
      learningTopics: [mockTopic],
    });
  });

  it('filters out topics whose latest state is skipped', async () => {
    vi.mocked(apiGet).mockResolvedValue(
      buildSchema({
        topicGroups: [
          [
            {
              data: mockTopic,
              stateHistory: [
                { state: 'not-explored', timestamp: TS },
                { state: 'skipped', timestamp: '2024-01-15T13:00:00.000Z' },
              ],
            },
            {
              data: { ...mockTopic, id: 'topic-2', title: 'Docker' },
              stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T13:00:00.000Z' }],
            },
          ],
        ],
      }),
    );

    const result = await focusStore.getTodaysFocus();
    expect(result?.learningTopics).toHaveLength(1);
    expect(result?.learningTopics[0].id).toBe('topic-2');
  });

  it('filters out explored topics that have been replaced', async () => {
    const explored = { ...mockTopic, replacedByTopicId: 'topic-2' };
    const replacement = { ...mockTopic, id: 'topic-2', title: 'New Topic' };

    vi.mocked(apiGet).mockResolvedValue(
      buildSchema({
        topicGroups: [
          [
            {
              data: explored,
              stateHistory: [
                { state: 'not-explored', timestamp: TS },
                { state: 'explored', timestamp: '2024-01-15T13:00:00.000Z' },
              ],
            },
            {
              data: replacement,
              stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T14:00:00.000Z' }],
            },
          ],
        ],
      }),
    );

    const result = await focusStore.getTodaysFocus();
    expect(result?.learningTopics).toHaveLength(1);
    expect(result?.learningTopics[0].id).toBe('topic-2');
  });

  it('limits the dashboard topic list to 3 entries', async () => {
    const topics = Array.from({ length: 5 }, (_, i) => ({
      data: { ...mockTopic, id: `topic-${i}`, title: `Topic ${i}` },
      stateHistory: [{ state: 'not-explored', timestamp: TS }],
    }));

    vi.mocked(apiGet).mockResolvedValue(buildSchema({ topicGroups: [topics] }));

    const result = await focusStore.getTodaysFocus();
    expect(result?.learningTopics).toHaveLength(3);
  });

  it('prioritises not-explored topics ahead of explored ones', async () => {
    vi.mocked(apiGet).mockResolvedValue(
      buildSchema({
        topicGroups: [
          [
            {
              data: { ...mockTopic, id: 'topic-1', title: 'Explored 1' },
              stateHistory: [
                { state: 'not-explored', timestamp: TS },
                { state: 'explored', timestamp: '2024-01-15T13:00:00.000Z' },
              ],
            },
            {
              data: { ...mockTopic, id: 'topic-2', title: 'Not Explored' },
              stateHistory: [{ state: 'not-explored', timestamp: TS }],
            },
          ],
        ],
      }),
    );

    const result = await focusStore.getTodaysFocus();
    expect(result?.learningTopics[0].id).toBe('topic-2');
    expect(result?.learningTopics[1].id).toBe('topic-1');
  });

  it('includes calibration items in the returned focus', async () => {
    const calibrationItem: CalibrationNeededItem = {
      skillId: 'typescript',
      displayName: 'TypeScript',
      suggestedLevel: 'intermediate',
    };
    vi.mocked(apiGet).mockResolvedValue(buildSchema({ calibrationNeeded: [calibrationItem] }));

    const result = await focusStore.getTodaysFocus();
    expect(result?.calibrationNeeded).toEqual([calibrationItem]);
  });
});

describe('focusStore.getHistory', () => {
  it('returns the full history map from storage', async () => {
    const schema: FocusStorageSchema = {
      history: { '2024-01-15': { challenges: [], goals: [], learningTopics: [] } },
    };
    vi.mocked(apiGet).mockResolvedValue(schema);
    expect(await focusStore.getHistory()).toEqual(schema.history);
  });

  it('returns an empty object when no history exists', async () => {
    vi.mocked(apiGet).mockResolvedValue({ history: {} });
    expect(await focusStore.getHistory()).toEqual({});
  });
});

describe('focusStore.isNewDay', () => {
  it.each([
    ['no focus has been saved for today', { history: {} } as FocusStorageSchema, true],
    ['focus already exists for today', buildSchema(), false],
  ])('returns %s → %s', async (_label, schema, expected) => {
    vi.mocked(apiGet).mockResolvedValue(schema);
    expect(await focusStore.isNewDay()).toBe(expected);
  });
});

describe('focusStore.getCalibrationNeeded', () => {
  it("returns today's calibration items when present", async () => {
    const items: CalibrationNeededItem[] = [
      { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
    ];
    vi.mocked(apiGet).mockResolvedValue(buildSchema({ calibrationNeeded: items }));
    expect(await focusStore.getCalibrationNeeded()).toEqual(items);
  });

  it('returns an empty array when no calibration is needed', async () => {
    vi.mocked(apiGet).mockResolvedValue({ history: {} });
    expect(await focusStore.getCalibrationNeeded()).toEqual([]);
  });
});
