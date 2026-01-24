/**
 * Focus Item State Machine
 * 
 * Provides type-safe state management for daily focus items (challenges, goals, topics).
 * Tracks state transitions with full audit trail and validates state changes.
 * 
 * @example
 * ```typescript
 * const challenge: StatefulChallenge = {
 *   data: { id: '123', title: 'Build API', ... },
 *   stateHistory: [{ state: 'not-started', timestamp: now() }]
 * };
 * 
 * // Transition to in-progress
 * const updated = transitionChallengeState(challenge, 'in-progress');
 * 
 * // Check current state
 * const state = getCurrentChallengeState(challenge); // 'in-progress'
 * ```
 */

import { getCurrentState as getStateFromHistory, validateTransition, type StateTransition, type StatefulItem } from '@/lib/state-machine';
import { now } from '@/lib/utils/date-utils';
import type { DailyChallenge, DailyGoal, LearningTopic } from './base-types';

// =============================================================================
// State Definitions
// =============================================================================

/**
 * Valid states for a challenge.
 */
export type ChallengeState = 'not-started' | 'in-progress' | 'completed' | 'skipped';

/**
 * Valid states for a goal.
 */
export type GoalState = 'not-started' | 'in-progress' | 'completed' | 'skipped';

/**
 * Valid states for a learning topic.
 */
export type TopicState = 'not-explored' | 'explored' | 'skipped';

/**
 * Challenge with state tracking.
 */
export type StatefulChallenge = StatefulItem<DailyChallenge, ChallengeState>;

/**
 * Goal with state tracking.
 */
export type StatefulGoal = StatefulItem<DailyGoal, GoalState>;

/**
 * Learning topic with state tracking.
 */
export type StatefulTopic = StatefulItem<LearningTopic, TopicState>;

// =============================================================================
// Valid State Transitions
// =============================================================================

/**
 * Valid challenge state transitions.
 * Key is current state, value is array of valid next states.
 */
const VALID_CHALLENGE_TRANSITIONS: Record<ChallengeState, ChallengeState[]> = {
  'not-started': ['in-progress', 'skipped'],
  'in-progress': ['completed', 'skipped'],
  'completed': [], // Terminal state
  'skipped': [], // Terminal state
};

/**
 * Valid goal state transitions.
 */
const VALID_GOAL_TRANSITIONS: Record<GoalState, GoalState[]> = {
  'not-started': ['in-progress', 'completed', 'skipped'],
  'in-progress': ['completed', 'skipped'],
  'completed': [], // Terminal state
  'skipped': [], // Terminal state
};

/**
 * Valid topic state transitions.
 */
const VALID_TOPIC_TRANSITIONS: Record<TopicState, TopicState[]> = {
  'not-explored': ['explored', 'skipped'],
  'explored': [], // Terminal state
  'skipped': [], // Terminal state
};

// =============================================================================
// State Query Helpers
// =============================================================================

/**
 * Gets the current state from state history.
 * Returns the most recent state transition.
 */
function getCurrentState<TState>(stateHistory: StateTransition<TState>[]): TState {
  return getStateFromHistory(stateHistory);
}

/**
 * Gets current challenge state.
 */
export function getCurrentChallengeState(challenge: StatefulChallenge): ChallengeState {
  return getCurrentState(challenge.stateHistory);
}

/**
 * Gets current goal state.
 */
export function getCurrentGoalState(goal: StatefulGoal): GoalState {
  return getCurrentState(goal.stateHistory);
}

/**
 * Gets current topic state.
 * @internal Not exported - only used within this module
 */
function getCurrentTopicState(topic: StatefulTopic): TopicState {
  return getCurrentState(topic.stateHistory);
}

// =============================================================================
// State Transition Logic
// =============================================================================

/**
 * Transitions a challenge to a new state.
 * 
 * @param challenge - The challenge to transition
 * @param newState - The target state
 * @param source - Optional source of transition
 * @param note - Optional note about the transition
 * @returns New challenge with updated state history
 * 
 * @throws {Error} If transition is invalid
 */
export function transitionChallengeState(
  challenge: StatefulChallenge,
  newState: ChallengeState,
  source?: string,
  note?: string
): StatefulChallenge {
  const currentState = getCurrentChallengeState(challenge);
  
  // Validate transition
  validateTransition(currentState, newState, VALID_CHALLENGE_TRANSITIONS, 'challenge');

  // Create new transition
  const transition: StateTransition<ChallengeState> = {
    state: newState,
    timestamp: now(),
    source,
    note,
  };

  return {
    ...challenge,
    stateHistory: [...challenge.stateHistory, transition],
  };
}

/**
 * Transitions a goal to a new state.
 * 
 * @param goal - The goal to transition
 * @param newState - The target state
 * @param source - Optional source of transition
 * @param note - Optional note about the transition
 * @returns New goal with updated state history
 * 
 * @throws {Error} If transition is invalid
 */
export function transitionGoalState(
  goal: StatefulGoal,
  newState: GoalState,
  source?: string,
  note?: string
): StatefulGoal {
  const currentState = getCurrentGoalState(goal);
  
  // Validate transition
  validateTransition(currentState, newState, VALID_GOAL_TRANSITIONS, 'goal');

  // Create new transition
  const transition: StateTransition<GoalState> = {
    state: newState,
    timestamp: now(),
    source,
    note,
  };

  return {
    ...goal,
    stateHistory: [...goal.stateHistory, transition],
  };
}

/**
 * Transitions a topic to a new state.
 * 
 * @param topic - The topic to transition
 * @param newState - The target state
 * @param source - Optional source of transition
 * @param note - Optional note about the transition
 * @returns New topic with updated state history
 * 
 * @throws {Error} If transition is invalid
 */
export function transitionTopicState(
  topic: StatefulTopic,
  newState: TopicState,
  source?: string,
  note?: string
): StatefulTopic {
  const currentState = getCurrentTopicState(topic);
  
  // Validate transition
  validateTransition(currentState, newState, VALID_TOPIC_TRANSITIONS, 'topic');

  // Create new transition
  const transition: StateTransition<TopicState> = {
    state: newState,
    timestamp: now(),
    source,
    note,
  };

  return {
    ...topic,
    stateHistory: [...topic.stateHistory, transition],
  };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Creates a new stateful challenge with initial state.
 */
export function createStatefulChallenge(
  challenge: DailyChallenge,
  initialState: ChallengeState = 'not-started'
): StatefulChallenge {
  return {
    data: challenge,
    stateHistory: [
      {
        state: initialState,
        timestamp: now(),
        source: 'system',
      },
    ],
  };
}

/**
 * Creates a new stateful goal with initial state.
 */
export function createStatefulGoal(
  goal: DailyGoal,
  initialState: GoalState = 'not-started'
): StatefulGoal {
  return {
    data: goal,
    stateHistory: [
      {
        state: initialState,
        timestamp: now(),
        source: 'system',
      },
    ],
  };
}

/**
 * Creates a new stateful topic with initial state.
 */
export function createStatefulTopic(
  topic: LearningTopic,
  initialState: TopicState = 'not-explored'
): StatefulTopic {
  return {
    data: topic,
    stateHistory: [
      {
        state: initialState,
        timestamp: now(),
        source: 'system',
      },
    ],
  };
}


