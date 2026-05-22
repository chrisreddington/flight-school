import { describe, expect, it } from 'vitest';
import type { FocusHistory, LearningTopic } from './types';
import { markTopicReviewedInHistory } from './review-schedule';

describe('focus review schedule operations', () => {
  const topic: LearningTopic = {
    id: 'topic-1',
    title: 'GitHub Actions',
    description: 'Learn about GitHub Actions',
    category: 'devops',
    estimatedMinutes: 20,
    resources: [],
  };

  it('should mark a matching topic as reviewed without changing topic state', () => {
    const history: FocusHistory = {
      '2024-01-15': {
        challenges: [],
        goals: [],
        learningTopics: [[{
          data: topic,
          stateHistory: [{ state: 'explored', timestamp: '2024-01-15T12:00:00.000Z' }],
        }]],
      },
    };

    const result = markTopicReviewedInHistory(
      history,
      '2024-01-15',
      'topic-1',
      '2024-01-16T09:00:00.000Z',
    );

    expect(result).toBe(true);
    expect(history['2024-01-15'].learningTopics[0][0].data.lastReviewedAt).toBe('2024-01-16T09:00:00.000Z');
    expect(history['2024-01-15'].learningTopics[0][0].stateHistory).toEqual([
      { state: 'explored', timestamp: '2024-01-15T12:00:00.000Z' },
    ]);
  });

  it('should return false when the date or topic is missing', () => {
    const history: FocusHistory = {
      '2024-01-15': {
        challenges: [],
        goals: [],
        learningTopics: [[{
          data: topic,
          stateHistory: [{ state: 'explored', timestamp: '2024-01-15T12:00:00.000Z' }],
        }]],
      },
    };

    expect(markTopicReviewedInHistory(history, '2024-01-14', 'topic-1', '2024-01-16T09:00:00.000Z')).toBe(false);
    expect(markTopicReviewedInHistory(history, '2024-01-15', 'missing-topic', '2024-01-16T09:00:00.000Z')).toBe(false);
  });
});
