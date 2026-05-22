import { describe, expect, it, vi } from 'vitest';
import type { DailyChallenge, DailyGoal, FocusHistory, FocusResponse, LearningTopic } from './types';
import { MAX_HISTORY_ENTRIES } from './types';
import {
  getTodaysFocusFromHistory,
  pruneHistory,
  saveFocusToHistory,
} from './history';

vi.mock('@/lib/utils/date-utils', () => ({
  now: vi.fn(() => '2024-01-15T12:00:00.000Z'),
}));

describe('focus history operations', () => {
  const challenge: DailyChallenge = {
    id: 'challenge-1',
    title: 'Build a CI Pipeline',
    description: 'Set up a CI pipeline for your project',
    difficulty: 'intermediate',
    language: 'TypeScript',
    estimatedMinutes: 30,
    tags: ['ci-cd'],
  };

  const goal: DailyGoal = {
    id: 'goal-1',
    title: 'Complete the CI challenge',
    description: 'Finish setting up the pipeline',
    category: 'technical',
    estimatedMinutes: 30,
  };

  const topic: LearningTopic = {
    id: 'topic-1',
    title: 'GitHub Actions',
    description: 'Learn about GitHub Actions',
    category: 'devops',
    estimatedMinutes: 20,
    resources: [],
  };

  const focusResponse: FocusResponse = {
    challenge,
    goal,
    learningTopics: [topic],
    meta: {
      generatedAt: '2024-01-15T12:00:00.000Z',
      aiEnabled: true,
      model: 'gpt-4',
      toolsUsed: [],
      totalTimeMs: 1000,
      usedCachedProfile: true,
    },
  };

  it('should reconstruct todays focus with displayable topics prioritized', () => {
    const exploredTopic = { ...topic, id: 'topic-2', title: 'Explored topic' };
    const skippedTopic = { ...topic, id: 'topic-3', title: 'Skipped topic' };
    const replacementTopic = { ...topic, id: 'topic-4', title: 'Replacement topic' };
    const history: FocusHistory = {
      '2024-01-15': {
        challenges: [{
          data: challenge,
          stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T10:00:00.000Z' }],
        }],
        goals: [{
          data: goal,
          stateHistory: [{ state: 'not-started', timestamp: '2024-01-15T11:00:00.000Z' }],
        }],
        learningTopics: [[
          {
            data: { ...exploredTopic, replacedByTopicId: replacementTopic.id },
            stateHistory: [
              { state: 'not-explored', timestamp: '2024-01-15T09:00:00.000Z' },
              { state: 'explored', timestamp: '2024-01-15T10:00:00.000Z' },
            ],
          },
          {
            data: skippedTopic,
            stateHistory: [
              { state: 'not-explored', timestamp: '2024-01-15T09:00:00.000Z' },
              { state: 'skipped', timestamp: '2024-01-15T10:00:00.000Z' },
            ],
          },
          {
            data: replacementTopic,
            stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
          },
          {
            data: topic,
            stateHistory: [
              { state: 'not-explored', timestamp: '2024-01-15T09:00:00.000Z' },
              { state: 'explored', timestamp: '2024-01-15T10:00:00.000Z' },
            ],
          },
        ]],
      },
    };

    const result = getTodaysFocusFromHistory(history, '2024-01-15');

    expect(result?.learningTopics.map((item) => item.id)).toEqual(['topic-4', 'topic-1']);
    expect(result?.meta.generatedAt).toBe('2024-01-15T11:00:00.000Z');
  });

  it('should append changed focus components without duplicating unchanged components', () => {
    const history = saveFocusToHistory({}, '2024-01-15', {
      ...focusResponse,
      calibrationNeeded: [
        { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
      ],
    });
    const updatedHistory = saveFocusToHistory(history, '2024-01-15', {
      ...focusResponse,
      challenge: { ...challenge, title: 'Different Challenge' },
      calibrationNeeded: [
        { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'advanced' },
        { skillId: 'react', displayName: 'React', suggestedLevel: 'advanced' },
      ],
    });

    const record = updatedHistory['2024-01-15'];
    expect(record.challenges).toHaveLength(2);
    expect(record.goals).toHaveLength(1);
    expect(record.learningTopics).toHaveLength(1);
    expect(record.calibrationNeeded).toEqual([
      { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' },
      { skillId: 'react', displayName: 'React', suggestedLevel: 'advanced' },
    ]);
  });

  it('should prune history to the newest retained date keys', () => {
    const history = Object.fromEntries(
      Array.from({ length: MAX_HISTORY_ENTRIES + 1 }, (_, index) => [
        `2024-01-${String(index + 1).padStart(2, '0')}`,
        { challenges: [], goals: [], learningTopics: [] },
      ]),
    );

    const pruned = pruneHistory(history);

    expect(Object.keys(pruned)).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(pruned['2024-01-31']).toBeDefined();
    expect(pruned['2024-01-01']).toBeUndefined();
  });
});
