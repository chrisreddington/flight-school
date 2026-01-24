/**
 * Focus State Machine Tests
 *
 * Tests for state transitions on challenges, goals, and topics.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  getCurrentChallengeState,
  getCurrentGoalState,
  transitionChallengeState,
  transitionGoalState,
  transitionTopicState,
  createStatefulChallenge,
  createStatefulGoal,
  createStatefulTopic,
  type StatefulChallenge,
  type StatefulGoal,
} from './state-machine';
import type { DailyChallenge, DailyGoal, LearningTopic } from './base-types';

// Mock date utilities
vi.mock('@/lib/utils/date-utils', () => ({
  now: () => '2026-01-24T12:00:00.000Z',
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const mockChallenge: DailyChallenge = {
  id: 'challenge-1',
  title: 'Test Challenge',
  description: 'A test challenge',
  difficulty: 'beginner',
  language: 'TypeScript',
  estimatedTime: '30 minutes',
  whyThisChallenge: ['reason 1'],
};

const mockGoal: DailyGoal = {
  id: 'goal-1',
  title: 'Test Goal',
  description: 'A test goal',
  progress: 0,
  target: 'Complete something',
  reasoning: 'Because testing',
};

const mockTopic: LearningTopic = {
  id: 'topic-1',
  title: 'Test Topic',
  description: 'A test topic',
  type: 'concept',
  relatedTo: 'testing',
};

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createStatefulChallenge', () => {
  it('should create a challenge with default not-started state', () => {
    const result = createStatefulChallenge(mockChallenge);

    expect(result.data).toEqual(mockChallenge);
    expect(result.stateHistory).toHaveLength(1);
    expect(result.stateHistory[0].state).toBe('not-started');
    expect(result.stateHistory[0].source).toBe('system');
  });

  it('should create a challenge with specified initial state', () => {
    const result = createStatefulChallenge(mockChallenge, 'in-progress');

    expect(result.stateHistory[0].state).toBe('in-progress');
  });
});

describe('createStatefulGoal', () => {
  it('should create a goal with default not-started state', () => {
    const result = createStatefulGoal(mockGoal);

    expect(result.data).toEqual(mockGoal);
    expect(result.stateHistory).toHaveLength(1);
    expect(result.stateHistory[0].state).toBe('not-started');
  });
});

describe('createStatefulTopic', () => {
  it('should create a topic with default not-explored state', () => {
    const result = createStatefulTopic(mockTopic);

    expect(result.data).toEqual(mockTopic);
    expect(result.stateHistory).toHaveLength(1);
    expect(result.stateHistory[0].state).toBe('not-explored');
  });
});

// =============================================================================
// State Query Tests
// =============================================================================

describe('getCurrentChallengeState', () => {
  it('should return the most recent state', () => {
    const challenge: StatefulChallenge = {
      data: mockChallenge,
      stateHistory: [
        { state: 'not-started', timestamp: '2026-01-24T10:00:00.000Z' },
        { state: 'in-progress', timestamp: '2026-01-24T11:00:00.000Z' },
      ],
    };

    expect(getCurrentChallengeState(challenge)).toBe('in-progress');
  });
});

describe('getCurrentGoalState', () => {
  it('should return the most recent state', () => {
    const goal: StatefulGoal = {
      data: mockGoal,
      stateHistory: [
        { state: 'not-started', timestamp: '2026-01-24T10:00:00.000Z' },
        { state: 'completed', timestamp: '2026-01-24T11:00:00.000Z' },
      ],
    };

    expect(getCurrentGoalState(goal)).toBe('completed');
  });
});

// =============================================================================
// Challenge State Transitions
// =============================================================================

describe('transitionChallengeState', () => {
  describe('valid transitions', () => {
    it.each([
      { from: 'not-started', to: 'in-progress' },
      { from: 'not-started', to: 'skipped' },
      { from: 'in-progress', to: 'completed' },
      { from: 'in-progress', to: 'skipped' },
    ] as const)(
      'should allow transition from $from to $to',
      ({ from, to }) => {
        const challenge = createStatefulChallenge(mockChallenge, from);
        const result = transitionChallengeState(challenge, to);

        expect(result.stateHistory).toHaveLength(2);
        expect(result.stateHistory[1].state).toBe(to);
      }
    );
  });

  describe('invalid transitions', () => {
    it.each([
      { from: 'not-started', to: 'completed' },
      { from: 'completed', to: 'in-progress' },
      { from: 'completed', to: 'not-started' },
      { from: 'skipped', to: 'in-progress' },
      { from: 'skipped', to: 'completed' },
    ] as const)(
      'should throw for invalid transition from $from to $to',
      ({ from, to }) => {
        const challenge = createStatefulChallenge(mockChallenge, from);
        expect(() => transitionChallengeState(challenge, to)).toThrow();
      }
    );
  });

  it('should include source and note in transition', () => {
    const challenge = createStatefulChallenge(mockChallenge);
    const result = transitionChallengeState(challenge, 'in-progress', 'user-action', 'Started working');

    expect(result.stateHistory[1].source).toBe('user-action');
    expect(result.stateHistory[1].note).toBe('Started working');
  });

  it('should preserve original data', () => {
    const challenge = createStatefulChallenge(mockChallenge);
    const result = transitionChallengeState(challenge, 'in-progress');

    expect(result.data).toEqual(mockChallenge);
  });
});

// =============================================================================
// Goal State Transitions
// =============================================================================

describe('transitionGoalState', () => {
  describe('valid transitions', () => {
    it.each([
      { from: 'not-started', to: 'in-progress' },
      { from: 'not-started', to: 'completed' },
      { from: 'not-started', to: 'skipped' },
      { from: 'in-progress', to: 'completed' },
      { from: 'in-progress', to: 'skipped' },
    ] as const)(
      'should allow transition from $from to $to',
      ({ from, to }) => {
        const goal = createStatefulGoal(mockGoal, from);
        const result = transitionGoalState(goal, to);

        expect(result.stateHistory).toHaveLength(2);
        expect(result.stateHistory[1].state).toBe(to);
      }
    );
  });

  describe('invalid transitions', () => {
    it.each([
      { from: 'completed', to: 'in-progress' },
      { from: 'completed', to: 'not-started' },
      { from: 'skipped', to: 'in-progress' },
    ] as const)(
      'should throw for invalid transition from $from to $to',
      ({ from, to }) => {
        const goal = createStatefulGoal(mockGoal, from);
        expect(() => transitionGoalState(goal, to)).toThrow();
      }
    );
  });
});

// =============================================================================
// Topic State Transitions
// =============================================================================

describe('transitionTopicState', () => {
  describe('valid transitions', () => {
    it.each([
      { from: 'not-explored', to: 'explored' },
      { from: 'not-explored', to: 'skipped' },
    ] as const)(
      'should allow transition from $from to $to',
      ({ from, to }) => {
        const topic = createStatefulTopic(mockTopic, from);
        const result = transitionTopicState(topic, to);

        expect(result.stateHistory).toHaveLength(2);
        expect(result.stateHistory[1].state).toBe(to);
      }
    );
  });

  describe('invalid transitions', () => {
    it.each([
      { from: 'explored', to: 'not-explored' },
      { from: 'explored', to: 'skipped' },
      { from: 'skipped', to: 'explored' },
      { from: 'skipped', to: 'not-explored' },
    ] as const)(
      'should throw for invalid transition from $from to $to',
      ({ from, to }) => {
        const topic = createStatefulTopic(mockTopic, from);
        expect(() => transitionTopicState(topic, to)).toThrow();
      }
    );
  });
});
