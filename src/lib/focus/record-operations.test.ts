import { describe, expect, it, vi } from 'vitest';
import type { DailyChallenge, FocusHistory, LearningTopic } from './types';
import {
  addChallengeToHistory,
  addTopicToHistory,
  getTopicPositionFromHistory,
  saveSelfExplanationInHistory,
} from './record-operations';

vi.mock('@/lib/utils/date-utils', () => ({
  now: vi.fn(() => '2024-01-15T12:00:00.000Z'),
}));

describe('focus record operations', () => {
  const challenge: DailyChallenge = {
    id: 'challenge-1',
    title: 'Build a CI Pipeline',
    description: 'Set up a CI pipeline',
    difficulty: 'intermediate',
    language: 'TypeScript',
    estimatedMinutes: 30,
    tags: ['ci-cd'],
  };

  const topic: LearningTopic = {
    id: 'topic-1',
    title: 'GitHub Actions',
    description: 'Learn about GitHub Actions',
    category: 'devops',
    estimatedMinutes: 20,
    resources: [],
  };

  it('should add a challenge once and create the daily record when needed', () => {
    const history: FocusHistory = {};

    expect(addChallengeToHistory(history, '2024-01-15', challenge)).toBe('added');
    expect(addChallengeToHistory(history, '2024-01-15', challenge)).toBe('duplicate');

    expect(history['2024-01-15'].challenges).toHaveLength(1);
    expect(history['2024-01-15'].challenges[0].data).toEqual(challenge);
  });

  it('should save trimmed self-explanations for challenges and topics', () => {
    const history: FocusHistory = {
      '2024-01-15': {
        challenges: [
          {
            data: challenge,
            stateHistory: [{ state: 'completed', timestamp: '2024-01-15T12:00:00.000Z' }],
          },
        ],
        goals: [],
        learningTopics: [
          [
            {
              data: topic,
              stateHistory: [{ state: 'explored', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
          ],
        ],
      },
    };

    expect(saveSelfExplanationInHistory(history, '2024-01-15', 'challenge', 'challenge-1', '  I learned CI.  ')).toBe(
      'updated',
    );
    expect(saveSelfExplanationInHistory(history, '2024-01-15', 'topic', 'topic-1', 'Actions are workflows.')).toBe(
      'updated',
    );
    expect(saveSelfExplanationInHistory(history, '2024-01-15', 'topic', 'topic-1', '   ')).toBe('empty');

    expect(history['2024-01-15'].challenges[0].data.selfExplanation).toBe('I learned CI.');
    expect(history['2024-01-15'].learningTopics[0][0].data.selfExplanation).toBe('Actions are workflows.');
  });

  it('should compute active topic position and insert a replacement topic at that position', () => {
    const replacementTopic = { ...topic, id: 'topic-3', title: 'Replacement' };
    const history: FocusHistory = {
      '2024-01-15': {
        challenges: [],
        goals: [],
        learningTopics: [
          [
            {
              data: { ...topic, id: 'topic-0' },
              stateHistory: [{ state: 'skipped', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
            {
              data: topic,
              stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
            {
              data: { ...topic, id: 'topic-2' },
              stateHistory: [{ state: 'not-explored', timestamp: '2024-01-15T12:00:00.000Z' }],
            },
          ],
        ],
      },
    };

    const position = getTopicPositionFromHistory(history, '2024-01-15', 'topic-2');
    const added = addTopicToHistory(history, '2024-01-15', replacementTopic, position ?? undefined);

    expect(position).toBe(1);
    expect(added).toBe(true);
    expect(history['2024-01-15'].learningTopics[0].map((item) => item.data.id)).toEqual([
      'topic-0',
      'topic-3',
      'topic-1',
      'topic-2',
    ]);
  });
});
