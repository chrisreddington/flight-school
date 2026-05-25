/**
 * Focus Storage State Transitions
 *
 * Free-function helpers that mutate a `FocusStorageSchema` in-place to
 * transition challenges, goals, and topics through their state
 * machines. Extracted from `LocalStorageFocusStore` so that file stays
 * a thin read/write coordinator. Each helper returns `true` when the
 * schema mutated (caller persists), `false` otherwise.
 */

import { logger } from '@/lib/logger';
import { isTodayDateKey, now } from '@/lib/utils/date-utils';

import { markTopicReplacedInHistory, saveSelfExplanationInHistory } from './record-operations';
import { markTopicReviewedInHistory } from './review-schedule';
import {
  getCurrentChallengeState,
  getCurrentGoalState,
  getCurrentTopicState,
  isTerminalChallengeState,
  isTerminalGoalState,
  isTerminalTopicState,
  transitionChallengeState,
  transitionGoalState,
  transitionTopicState,
  type ChallengeState,
  type GoalState,
  type TopicState,
} from './state-machine';
import type { FocusStorageSchema } from './types';

const log = logger.withTag('FocusStore');

/**
 * Apply a challenge state transition with state-machine guards.
 * Mutates `schema.history[dateKey]` in place when a transition fires.
 */
export function applyChallengeTransition(
  schema: FocusStorageSchema,
  dateKey: string,
  challengeId: string,
  newState: ChallengeState,
  source?: string,
): boolean {
  if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
    log.warn('Cannot skip challenge outside of today', { dateKey, challengeId });
    return false;
  }

  const record = schema.history[dateKey];
  if (!record) {
    log.warn('Attempted to transition challenge for non-existent date', { dateKey, challengeId });
    return false;
  }

  const index = record.challenges.findIndex((c) => c.data.id === challengeId);
  if (index === -1) {
    log.warn('Challenge not found in record', { dateKey, challengeId });
    return false;
  }

  const currentChallenge = record.challenges[index];
  const currentState = getCurrentChallengeState(currentChallenge);

  if (currentState === newState) {
    log.debug('Challenge already in target state (idempotent)', {
      dateKey,
      challengeId,
      state: currentState,
    });
    return false;
  }
  if (isTerminalChallengeState(currentState)) {
    log.debug('Challenge in terminal state, cannot transition', {
      dateKey,
      challengeId,
      currentState,
      newState,
    });
    return false;
  }
  if (currentState === 'completed' && newState === 'skipped') {
    log.warn('Cannot skip completed challenge', { dateKey, challengeId });
    return false;
  }

  try {
    record.challenges[index] = transitionChallengeState(currentChallenge, newState, source);
    log.debug('Challenge state transitioned', {
      dateKey,
      challengeId,
      from: currentState,
      to: newState,
      source,
    });
    return true;
  } catch (error) {
    log.error('Challenge state transition failed', {
      dateKey,
      challengeId,
      currentState,
      newState,
      error,
    });
    return false;
  }
}

/**
 * Apply a goal state transition with state-machine guards.
 */
export function applyGoalTransition(
  schema: FocusStorageSchema,
  dateKey: string,
  goalId: string,
  newState: GoalState,
  source?: string,
): boolean {
  if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
    log.warn('Cannot skip goal outside of today', { dateKey, goalId });
    return false;
  }

  const record = schema.history[dateKey];
  if (!record) {
    log.warn('Attempted to transition goal for non-existent date', { dateKey, goalId });
    return false;
  }

  const index = record.goals.findIndex((g) => g.data.id === goalId);
  if (index === -1) {
    log.warn('Goal not found in record', { dateKey, goalId });
    return false;
  }

  const currentGoal = record.goals[index];
  const currentState = getCurrentGoalState(currentGoal);

  if (currentState === newState) {
    log.debug('Goal already in target state (idempotent)', {
      dateKey,
      goalId,
      state: currentState,
    });
    return false;
  }
  if (isTerminalGoalState(currentState)) {
    log.debug('Goal in terminal state, cannot transition', {
      dateKey,
      goalId,
      currentState,
      newState,
    });
    return false;
  }
  if (currentState === 'completed' && newState === 'skipped') {
    log.warn('Cannot skip completed goal', { dateKey, goalId });
    return false;
  }

  try {
    record.goals[index] = transitionGoalState(currentGoal, newState, source);
    log.debug('Goal state transitioned', {
      dateKey,
      goalId,
      from: currentState,
      to: newState,
      source,
    });
    return true;
  } catch (error) {
    log.error('Goal state transition failed', {
      dateKey,
      goalId,
      currentState,
      newState,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Apply a topic state transition. Topics are nested in `learningTopics`
 * arrays; we scan all generations of the topic list to find the id.
 */
export function applyTopicTransition(
  schema: FocusStorageSchema,
  dateKey: string,
  topicId: string,
  newState: TopicState,
  source?: string,
): boolean {
  if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
    log.warn('Cannot skip topic outside of today', { dateKey, topicId });
    return false;
  }

  const record = schema.history[dateKey];
  if (!record) {
    log.warn('Attempted to transition topic for non-existent date', { dateKey, topicId });
    return false;
  }

  for (let i = 0; i < record.learningTopics.length; i++) {
    const topicArray = record.learningTopics[i];
    const topicIndex = topicArray.findIndex((t) => t.data.id === topicId);
    if (topicIndex === -1) continue;

    const currentTopic = topicArray[topicIndex];
    const currentState = getCurrentTopicState(currentTopic);

    if (currentState === newState) {
      log.debug('Topic already in target state (idempotent)', {
        dateKey,
        topicId,
        state: currentState,
      });
      return false;
    }
    if (isTerminalTopicState(currentState)) {
      log.debug('Topic in terminal state, cannot transition', {
        dateKey,
        topicId,
        currentState,
        newState,
      });
      return false;
    }

    try {
      record.learningTopics[i][topicIndex] = transitionTopicState(currentTopic, newState, source);
      log.debug('Topic transitioned', {
        dateKey,
        topicId,
        from: currentState,
        to: newState,
        source,
      });
      return true;
    } catch (error) {
      log.error('Topic state transition failed', {
        dateKey,
        topicId,
        currentState,
        newState,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  log.warn('Topic not found in record', { dateKey, topicId });
  return false;
}

export function applyTopicReviewed(schema: FocusStorageSchema, dateKey: string, topicId: string): boolean {
  const recordExists = Boolean(schema.history[dateKey]);
  if (!recordExists) {
    log.warn('Attempted to mark topic reviewed for non-existent date', { dateKey, topicId });
    return false;
  }
  const updated = markTopicReviewedInHistory(schema.history, dateKey, topicId, now());
  if (!updated) {
    log.warn('Topic not found for review tracking', { dateKey, topicId });
    return false;
  }
  log.debug('Topic marked as reviewed', { dateKey, topicId });
  return true;
}

export function applyTopicReplaced(
  schema: FocusStorageSchema,
  dateKey: string,
  oldTopicId: string,
  newTopicId: string,
): boolean {
  const updated = markTopicReplacedInHistory(schema.history, dateKey, oldTopicId, newTopicId);
  if (!updated) {
    log.warn('Attempted to mark topic replaced for non-existent date', { dateKey, oldTopicId });
    return false;
  }
  log.debug('Topic marked as replaced', { dateKey, oldTopicId, newTopicId });
  return true;
}

export function applySelfExplanation(
  schema: FocusStorageSchema,
  dateKey: string,
  itemType: 'challenge' | 'topic',
  itemId: string,
  text: string,
): boolean {
  const result = saveSelfExplanationInHistory(schema.history, dateKey, itemType, itemId, text);
  if (result === 'empty') return false;
  if (result === 'missing-record') {
    log.warn('Attempted to save self-explanation for non-existent date', {
      dateKey,
      itemType,
      itemId,
    });
    return false;
  }
  if (result === 'missing-challenge') {
    log.warn('Challenge not found for self-explanation', { dateKey, itemId });
    return false;
  }
  if (result === 'missing-topic') {
    log.warn('Topic not found for self-explanation', { dateKey, itemId });
    return false;
  }
  log.debug(`Saved ${itemType} self-explanation`, { dateKey, itemId });
  return true;
}
