/**
 * Focus Storage Record Mutations
 *
 * Free-function helpers that mutate `FocusStorageSchema` in place to
 * add new challenges/goals/topics or to remove calibration items.
 * Extracted from `LocalStorageFocusStore`. Each helper returns `true`
 * when the schema mutated (caller persists), `false` otherwise.
 */

import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';

import {
  addChallengeToHistory,
  addGoalToHistory,
  addTopicToHistory,
  getCalibrationNeededFromHistory,
  getTopicPositionFromHistory,
  removeCalibrationItemFromHistory,
} from './record-operations';
import type { CalibrationNeededItem, DailyChallenge, DailyGoal, FocusStorageSchema, LearningTopic } from './types';

const log = logger.withTag('FocusStore');

export function applyAddTopic(
  schema: FocusStorageSchema,
  dateKey: string,
  newTopic: LearningTopic,
  position?: number,
): boolean {
  if (!isTodayDateKey(dateKey)) {
    log.warn('Cannot add topic outside of today', { dateKey, newTopicId: newTopic.id });
    return false;
  }
  const record = schema.history[dateKey];
  if (!record || record.learningTopics.length === 0) {
    log.warn('Attempted to add topic for non-existent date or empty topics', { dateKey });
    return false;
  }

  const latestTopicCount = record.learningTopics[record.learningTopics.length - 1].length;
  const insertedAtPosition = position !== undefined && position >= 0 && position <= latestTopicCount;
  addTopicToHistory(schema.history, dateKey, newTopic, position);

  if (insertedAtPosition) {
    log.debug('Topic inserted at position', { dateKey, newTopicId: newTopic.id, position });
  } else {
    log.debug('Topic added', { dateKey, newTopicId: newTopic.id });
  }
  return true;
}

export function applyAddChallenge(schema: FocusStorageSchema, dateKey: string, newChallenge: DailyChallenge): boolean {
  if (!isTodayDateKey(dateKey)) {
    log.warn('Cannot add challenge outside of today', { dateKey, newChallengeId: newChallenge.id });
    return false;
  }
  const result = addChallengeToHistory(schema.history, dateKey, newChallenge);
  if (result === 'duplicate') {
    log.debug('Challenge already registered (idempotent)', {
      dateKey,
      challengeId: newChallenge.id,
    });
    return false;
  }
  log.debug('Challenge added', { dateKey, newChallengeId: newChallenge.id });
  return true;
}

export function applyAddGoal(schema: FocusStorageSchema, dateKey: string, newGoal: DailyGoal): boolean {
  if (!isTodayDateKey(dateKey)) {
    log.warn('Cannot add goal outside of today', { dateKey, newGoalId: newGoal.id });
    return false;
  }
  const added = addGoalToHistory(schema.history, dateKey, newGoal);
  if (!added) {
    log.warn('Attempted to add goal for non-existent date', { dateKey });
    return false;
  }
  log.debug('Goal added', { dateKey, newGoalId: newGoal.id });
  return true;
}

export function applyRemoveCalibrationItem(schema: FocusStorageSchema, skillId: string): boolean {
  const todayKey = getDateKey();
  const updated = removeCalibrationItemFromHistory(schema.history, todayKey, skillId);
  if (!updated) return false;
  log.debug('Calibration item removed', { skillId });
  return true;
}

export function readCalibrationNeeded(schema: FocusStorageSchema): CalibrationNeededItem[] {
  const todayKey = getDateKey();
  return getCalibrationNeededFromHistory(schema.history, todayKey);
}

export function readTopicPosition(schema: FocusStorageSchema, dateKey: string, topicId: string): number | null {
  const record = schema.history[dateKey];
  if (!record || record.learningTopics.length === 0) return null;
  const activePosition = getTopicPositionFromHistory(schema.history, dateKey, topicId);
  if (activePosition === null) {
    log.warn('Topic not found for position lookup', { dateKey, topicId });
    return null;
  }
  log.debug('Found topic position', { dateKey, topicId, activePosition });
  return activePosition;
}
