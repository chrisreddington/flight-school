/**
 * Tests for the spaced repetition module.
 */

import { describe, it, expect } from 'vitest';
import { getSpacedRepCandidates, formatReviewLabel } from './spaced-repetition';
import type { FocusHistory } from './types';
import type { LearningTopic } from './base-types';

function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function makeTopic(id: string, title: string, daysAgo: number): { data: LearningTopic; stateHistory: [] } {
  return {
    data: {
      id,
      title,
      description: 'desc',
      type: 'concept' as const,
      relatedTo: 'test',
      explored: true,
      exploredAt: daysAgoISO(daysAgo),
    },
    stateHistory: [],
  };
}

function buildHistory(topics: { id: string; title: string; daysAgo: number }[]): FocusHistory {
  return {
    '2024-01-01': {
      challenges: [],
      goals: [],
      learningTopics: [topics.map((t) => makeTopic(t.id, t.title, t.daysAgo))],
    },
  };
}

describe('getSpacedRepCandidates', () => {
  it('returns empty array when no topics explored', () => {
    const history: FocusHistory = {
      '2024-01-01': { challenges: [], goals: [], learningTopics: [[]] },
    };
    expect(getSpacedRepCandidates(history)).toEqual([]);
  });

  it('returns empty array when all topics were explored today', () => {
    const history = buildHistory([{ id: 'a', title: 'Topic A', daysAgo: 0 }]);
    expect(getSpacedRepCandidates(history)).toEqual([]);
  });

  it('returns topics due after 1 day', () => {
    const history = buildHistory([{ id: 'a', title: 'Topic A', daysAgo: 1 }]);
    const candidates = getSpacedRepCandidates(history);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].topicId).toBe('a');
    expect(candidates[0].isForgotten).toBe(false);
  });

  it('marks topics as forgotten after 21 days', () => {
    const history = buildHistory([{ id: 'a', title: 'Topic A', daysAgo: 21 }]);
    const candidates = getSpacedRepCandidates(history);
    expect(candidates[0].isForgotten).toBe(true);
    expect(candidates[0].priority).toBe(100);
  });

  it('sorts by priority descending', () => {
    const history = buildHistory([
      { id: 'a', title: 'Topic A', daysAgo: 1 },
      { id: 'b', title: 'Topic B', daysAgo: 25 },
      { id: 'c', title: 'Topic C', daysAgo: 7 },
    ]);
    const candidates = getSpacedRepCandidates(history);
    expect(candidates[0].topicId).toBe('b'); // 25 days — highest priority
    expect(candidates[1].topicId).toBe('c'); // 7 days
    expect(candidates[2].topicId).toBe('a'); // 1 day — lowest priority
  });

  it('does not include unexplored topics', () => {
    const history: FocusHistory = {
      '2024-01-01': {
        challenges: [],
        goals: [],
        learningTopics: [[
          {
            data: {
              id: 'z',
              title: 'Unexplored',
              description: 'desc',
              type: 'concept' as const,
              relatedTo: 'test',
              // explored is undefined / false
            },
            stateHistory: [],
          },
        ]],
      },
    };
    expect(getSpacedRepCandidates(history)).toEqual([]);
  });
});

describe('formatReviewLabel', () => {
  it('returns "Review overdue" for forgotten topics', () => {
    const candidate = { topicId: 'a', title: 'T', daysSinceSeen: 25, isForgotten: true, priority: 100 };
    expect(formatReviewLabel(candidate)).toBe('Review overdue');
  });

  it('returns "Review due" for 7–20 day topics', () => {
    const candidate = { topicId: 'a', title: 'T', daysSinceSeen: 10, isForgotten: false, priority: 75 };
    expect(formatReviewLabel(candidate)).toBe('Review due');
  });

  it('returns "Due for review" for 3–6 day topics', () => {
    const candidate = { topicId: 'a', title: 'T', daysSinceSeen: 4, isForgotten: false, priority: 50 };
    expect(formatReviewLabel(candidate)).toBe('Due for review');
  });

  it('returns "Quick review" for 1–2 day topics', () => {
    const candidate = { topicId: 'a', title: 'T', daysSinceSeen: 1, isForgotten: false, priority: 25 };
    expect(formatReviewLabel(candidate)).toBe('Quick review');
  });
});
