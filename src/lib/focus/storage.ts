/**
 * Focus Storage
 *
 * Provides persistent storage for Daily Focus content using API route.
 * Handles day-based caching, history management, and schema versioning.
 *
 * @remarks
 * This module uses the `/api/focus/storage` API route for persistence
 * instead of localStorage. The data is stored server-side in `.data/focus-storage.json`.
 *
 * @example
 * ```typescript
 * import { focusStore } from '@/lib/focus';
 *
 * // Get today's cached focus (if any)
 * const cached = await focusStore.getTodaysFocus();
 *
 * // Save new focus
 * await focusStore.saveTodaysFocus(focusResponse);
 *
 * // Check if it's a new day
 * if (await focusStore.isNewDay()) {
 *   // Fetch fresh content
 * }
 * ```
 */

import { logger } from '@/lib/logger';
import { getDateKey, isTodayDateKey, now } from '@/lib/utils/date-utils';
import {
  transitionChallengeState,
  transitionGoalState,
  transitionTopicState,
  getCurrentChallengeState,
  getCurrentGoalState,
  getCurrentTopicState,
  isTerminalChallengeState,
  isTerminalGoalState,
  isTerminalTopicState,
  type ChallengeState,
  type GoalState,
  type TopicState,
} from './state-machine';
import type {
    CalibrationNeededItem,
    DailyChallenge,
    DailyGoal,
    FocusHistory,
    FocusResponse,
    FocusStorageSchema,
    LearningTopic,
} from './types';
import { getTodaysFocusFromHistory, saveFocusToHistory } from './history';
import { clearFocusStorage, readFocusStorage, writeFocusStorage } from './persistence';
import {
  addChallengeToHistory,
  addGoalToHistory,
  addTopicToHistory,
  getCalibrationNeededFromHistory,
  getTopicPositionFromHistory,
  markTopicReplacedInHistory,
  removeCalibrationItemFromHistory,
  saveSelfExplanationInHistory,
} from './record-operations';
import { markTopicReviewedInHistory } from './review-schedule';

const log = logger.withTag('FocusStore');

interface FocusStoreInterface {
  /** Get today's cached focus view (reconstructed from components) */
  getTodaysFocus(): Promise<FocusResponse | null>;
  /** Save focus content, appending changed components to history */
  saveTodaysFocus(focus: FocusResponse): Promise<void>;
  /** Get all historical focus entries (raw records) */
  getHistory(): Promise<FocusHistory>;
  /** Check if the current date differs from the last saved focus */
  isNewDay(): Promise<boolean>;
  /** Clear all stored focus data */
  clear(): Promise<void>;
  /** Transition challenge to new state */
  transitionChallenge(dateKey: string, challengeId: string, newState: ChallengeState, source?: string): Promise<void>;
  /** Transition goal to new state */
  transitionGoal(dateKey: string, goalId: string, newState: GoalState, source?: string): Promise<void>;
  /** Mark topic as explored */
  markTopicExplored(dateKey: string, topicId: string, source?: string): Promise<void>;
  /** Mark topic as reviewed without changing explored/skipped state */
  markTopicReviewed(dateKey: string, topicId: string): Promise<void>;
  /** Transition topic to new state (explored or skipped) */
  transitionTopic(dateKey: string, topicId: string, newState: TopicState, source?: string): Promise<void>;
  /** Save learner self-explanation text on a challenge or topic */
  saveSelfExplanation(dateKey: string, itemType: 'challenge' | 'topic', itemId: string, text: string): Promise<void>;
  /** Mark an explored topic as replaced by a new topic */
  markTopicReplaced(dateKey: string, oldTopicId: string, newTopicId: string): Promise<void>;
  /** Remove a calibration item (when confirmed or dismissed) */
  removeCalibrationItem(skillId: string): Promise<void>;
  /** Get pending calibration items for today */
  getCalibrationNeeded(): Promise<CalibrationNeededItem[]>;
  /** Get the position of a topic in the current day's active topics (for in-place replacement) */
  getTopicPosition(dateKey: string, topicId: string): Promise<number | null>;
  /** Add a new topic, optionally at a specific position */
  addTopic(dateKey: string, newTopic: LearningTopic, position?: number): Promise<void>;
  /** Add a new challenge (for regeneration after skip) */
  addChallenge(dateKey: string, newChallenge: DailyChallenge): Promise<void>;
  /** Add a new goal (for regeneration after skip) */
  addGoal(dateKey: string, newGoal: DailyGoal): Promise<void>;
}

/**
 * Server-backed FocusStore implementation.
 */
class LocalStorageFocusStore implements FocusStoreInterface {
  /**
   * Reads and parses storage data from API.
   */
  private async getStorage(): Promise<FocusStorageSchema> {
    return readFocusStorage();
  }

  private async setStorage(schema: FocusStorageSchema): Promise<void> {
    await writeFocusStorage(schema);
  }

  /**
   * Reconstructs the current view of the day's focus from the latest components.
   */
  async getTodaysFocus(): Promise<FocusResponse | null> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    return getTodaysFocusFromHistory(schema.history, todayKey);
  }

  /**
   * Decomposes and saves the focus response.
   * Creates stateful items with initial states.
   */
  async saveTodaysFocus(focus: FocusResponse): Promise<void> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    schema.history = saveFocusToHistory(schema.history, todayKey, focus);
    await this.setStorage(schema);
  }

  async getHistory(): Promise<FocusHistory> {
    const schema = await this.getStorage();
    return schema.history;
  }

  async isNewDay(): Promise<boolean> {
    return (await this.getTodaysFocus()) === null;
  }

  async clear(): Promise<void> {
    try {
      await clearFocusStorage();
      log.debug('Focus storage cleared successfully');
    } catch (error) {
      log.error('Failed to clear focus storage', { error });
      throw error;
    }
  }

  /**
   * Transition challenge to a new state.
   * Uses state machine to validate transitions.
   * Idempotent: returns early if already in target state.
   */
  async transitionChallenge(
    dateKey: string,
    challengeId: string,
    newState: ChallengeState,
    source?: string
  ): Promise<void> {
    if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
      log.warn('Cannot skip challenge outside of today', { dateKey, challengeId });
      return;
    }
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to transition challenge for non-existent date', { dateKey, challengeId });
      return;
    }

    // Find the challenge
    const index = record.challenges.findIndex(c => c.data.id === challengeId);
    if (index === -1) {
      log.warn('Challenge not found in record', { dateKey, challengeId });
      return;
    }

    // Use state machine to transition
    const currentChallenge = record.challenges[index];
    const currentState = getCurrentChallengeState(currentChallenge);
    
    // Idempotent: already in target state
    if (currentState === newState) {
      log.debug('Challenge already in target state (idempotent)', { dateKey, challengeId, state: currentState });
      return;
    }
    
    // Prevent transitions from terminal states (except idempotent which is handled above)
    if (isTerminalChallengeState(currentState)) {
      log.debug('Challenge in terminal state, cannot transition', { dateKey, challengeId, currentState, newState });
      return;
    }
    
    // Prevent skipping completed challenges (extra safety)
    if (currentState === 'completed' && newState === 'skipped') {
      log.warn('Cannot skip completed challenge', { dateKey, challengeId });
      return;
    }

    try {
      const updated = transitionChallengeState(currentChallenge, newState, source);
      record.challenges[index] = updated;
      
      await this.setStorage(schema);
      log.debug('Challenge state transitioned', { dateKey, challengeId, from: currentState, to: newState, source });
    } catch (error) {
      log.error('Challenge state transition failed', { dateKey, challengeId, currentState, newState, error });
    }
  }

  /**
   * Transition goal to a new state.
   * Uses state machine to validate transitions.
   * Idempotent: returns early if already in target state.
   */
  async transitionGoal(
    dateKey: string,
    goalId: string,
    newState: GoalState,
    source?: string
  ): Promise<void> {
    if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
      log.warn('Cannot skip goal outside of today', { dateKey, goalId });
      return;
    }
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to transition goal for non-existent date', { dateKey, goalId });
      return;
    }

    // Find the goal
    const index = record.goals.findIndex(g => g.data.id === goalId);
    if (index === -1) {
      log.warn('Goal not found in record', { dateKey, goalId });
      return;
    }

    // Use state machine to transition
    const currentGoal = record.goals[index];
    const currentState = getCurrentGoalState(currentGoal);
    
    // Idempotent: already in target state
    if (currentState === newState) {
      log.debug('Goal already in target state (idempotent)', { dateKey, goalId, state: currentState });
      return;
    }
    
    // Prevent transitions from terminal states (except idempotent which is handled above)
    if (isTerminalGoalState(currentState)) {
      log.debug('Goal in terminal state, cannot transition', { dateKey, goalId, currentState, newState });
      return;
    }
    
    // Prevent skipping completed goals (extra safety)
    if (currentState === 'completed' && newState === 'skipped') {
      log.warn('Cannot skip completed goal', { dateKey, goalId });
      return;
    }

    try {
      const updated = transitionGoalState(currentGoal, newState, source);
      record.goals[index] = updated;
      
      await this.setStorage(schema);
      log.debug('Goal state transitioned', { dateKey, goalId, from: currentState, to: newState, source });
    } catch (error) {
      log.error('Goal state transition failed', {
        dateKey,
        goalId,
        currentState,
        newState,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Mark a learning topic as explored.
   * Uses state machine to validate transitions.
   * Idempotent: returns early if already explored.
   */
  async markTopicExplored(
    dateKey: string,
    topicId: string,
    source?: string
  ): Promise<void> {
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to mark topic for non-existent date', { dateKey, topicId });
      return;
    }

    // Find and update the topic (topics are nested in arrays)
    for (let i = 0; i < record.learningTopics.length; i++) {
      const topicArray = record.learningTopics[i];
      const topicIndex = topicArray.findIndex(t => t.data.id === topicId);
      
      if (topicIndex !== -1) {
        const currentTopic = topicArray[topicIndex];
        const currentState = getCurrentTopicState(currentTopic);
        
        // Idempotent: already explored
        if (currentState === 'explored') {
          log.debug('Topic already explored (idempotent)', { dateKey, topicId });
          return;
        }
        
        // Cannot transition from terminal states (except idempotent handled above)
        if (isTerminalTopicState(currentState)) {
          log.debug('Topic in terminal state, cannot mark as explored', { dateKey, topicId, currentState });
          return;
        }

        try {
          const updated = transitionTopicState(currentTopic, 'explored', source);
          record.learningTopics[i][topicIndex] = updated;
          await this.setStorage(schema);
          log.debug('Topic marked as explored', { dateKey, topicId, from: currentState, source });
        } catch (error) {
          log.error('Topic state transition failed', {
            dateKey,
            topicId,
            currentState,
            targetState: 'explored',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    log.warn('Topic not found in record', { dateKey, topicId });
  }

  /**
   * Mark a learning topic as reviewed for spaced repetition tracking.
   * Does not change topic state (explored/skipped).
   */
  async markTopicReviewed(dateKey: string, topicId: string): Promise<void> {
    const schema = await this.getStorage();
    const recordExists = Boolean(schema.history[dateKey]);
    const updated = markTopicReviewedInHistory(schema.history, dateKey, topicId, now());

    if (!recordExists) {
      log.warn('Attempted to mark topic reviewed for non-existent date', { dateKey, topicId });
      return;
    }

    if (updated) {
      await this.setStorage(schema);
      log.debug('Topic marked as reviewed', { dateKey, topicId });
      return;
    }

    log.warn('Topic not found for review tracking', { dateKey, topicId });
  }

  /**
   * Transition a topic to a new state (explored or skipped).
   * Idempotent: returns early if already in target state.
   */
  async transitionTopic(
    dateKey: string,
    topicId: string,
    newState: TopicState,
    source?: string
  ): Promise<void> {
    if (newState === 'skipped' && !isTodayDateKey(dateKey)) {
      log.warn('Cannot skip topic outside of today', { dateKey, topicId });
      return;
    }
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to transition topic for non-existent date', { dateKey, topicId });
      return;
    }

    // Find and update the topic (topics are nested in arrays)
    for (let i = 0; i < record.learningTopics.length; i++) {
      const topicArray = record.learningTopics[i];
      const topicIndex = topicArray.findIndex(t => t.data.id === topicId);
      
      if (topicIndex !== -1) {
        const currentTopic = topicArray[topicIndex];
        const currentState = getCurrentTopicState(currentTopic);
        
        // Idempotent: already in target state
        if (currentState === newState) {
          log.debug('Topic already in target state (idempotent)', { dateKey, topicId, state: currentState });
          return;
        }
        
        // Cannot transition from terminal states (except idempotent handled above)
        if (isTerminalTopicState(currentState)) {
          log.debug('Topic in terminal state, cannot transition', { dateKey, topicId, currentState, newState });
          return;
        }

        try {
          const updated = transitionTopicState(currentTopic, newState, source);
          record.learningTopics[i][topicIndex] = updated;
          await this.setStorage(schema);
          log.debug('Topic transitioned', { dateKey, topicId, from: currentState, to: newState, source });
        } catch (error) {
          log.error('Topic state transition failed', {
            dateKey,
            topicId,
            currentState,
            newState,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
    }

    log.warn('Topic not found in record', { dateKey, topicId });
  }

  /**
   * Save learner self-explanation text for a challenge or topic.
   */
  async saveSelfExplanation(
    dateKey: string,
    itemType: 'challenge' | 'topic',
    itemId: string,
    text: string
  ): Promise<void> {
    const schema = await this.getStorage();
    const result = saveSelfExplanationInHistory(schema.history, dateKey, itemType, itemId, text);

    if (result === 'empty') return;
    if (result === 'missing-record') {
      log.warn('Attempted to save self-explanation for non-existent date', { dateKey, itemType, itemId });
      return;
    }
    if (result === 'missing-challenge') {
      log.warn('Challenge not found for self-explanation', { dateKey, itemId });
      return;
    }
    if (result === 'missing-topic') {
      log.warn('Topic not found for self-explanation', { dateKey, itemId });
      return;
    }

    await this.setStorage(schema);
    log.debug(`Saved ${itemType} self-explanation`, { dateKey, itemId });
  }

  /**
   * Get the position of a topic among active (non-skipped) topics.
   * Used for in-place replacement - insert new topic at same visual position.
   */
  async getTopicPosition(
    dateKey: string,
    topicId: string
  ): Promise<number | null> {
    const schema = await this.getStorage();
    const record = schema.history[dateKey];

    if (!record || record.learningTopics.length === 0) {
      return null;
    }

    const activePosition = getTopicPositionFromHistory(schema.history, dateKey, topicId);
    if (activePosition === null) {
      log.warn('Topic not found for position lookup', { dateKey, topicId });
      return null;
    }

    log.debug('Found topic position', { dateKey, topicId, activePosition });
    return activePosition;
  }

  /**
   * Add a new topic to the current day's most recent topics array.
   * Used when regenerating a topic - keeps the skipped one and adds the new one.
   * 
   * @param dateKey - The date key (YYYY-MM-DD)
   * @param newTopic - The new topic to add
   * @param position - Optional position index to insert at (for in-place replacement).
   *                   If not provided, appends to end.
   */
  async addTopic(
    dateKey: string,
    newTopic: LearningTopic,
    position?: number
  ): Promise<void> {
    if (!isTodayDateKey(dateKey)) {
      log.warn('Cannot add topic outside of today', { dateKey, newTopicId: newTopic.id });
      return;
    }
    const schema = await this.getStorage();
    const record = schema.history[dateKey];

    if (!record || record.learningTopics.length === 0) {
      log.warn('Attempted to add topic for non-existent date or empty topics', { dateKey });
      return;
    }

    const latestTopicCount = record.learningTopics[record.learningTopics.length - 1].length;
    const insertedAtPosition = position !== undefined && position >= 0 && position <= latestTopicCount;
    addTopicToHistory(schema.history, dateKey, newTopic, position);

    if (insertedAtPosition) {
      log.debug('Topic inserted at position', { dateKey, newTopicId: newTopic.id, position });
    } else {
      log.debug('Topic added', { dateKey, newTopicId: newTopic.id });
    }

    await this.setStorage(schema);
  }

  /**
   * Mark an explored topic as replaced by a new topic.
   * The old topic remains in "explored" state but won't show on dashboard.
   */
  async markTopicReplaced(
    dateKey: string,
    oldTopicId: string,
    newTopicId: string
  ): Promise<void> {
    const schema = await this.getStorage();
    const updated = markTopicReplacedInHistory(schema.history, dateKey, oldTopicId, newTopicId);

    if (!updated) {
      log.warn('Attempted to mark topic replaced for non-existent date', { dateKey, oldTopicId });
      return;
    }

    await this.setStorage(schema);
    log.debug('Topic marked as replaced', { dateKey, oldTopicId, newTopicId });
  }

  /**
   * Remove a calibration item when user confirms or dismisses it.
   */
  async removeCalibrationItem(skillId: string): Promise<void> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    const updated = removeCalibrationItemFromHistory(schema.history, todayKey, skillId);

    if (!updated) {
      return;
    }

    await this.setStorage(schema);
    log.debug('Calibration item removed', { skillId });
  }

  /**
   * Get pending calibration items for today.
   */
  async getCalibrationNeeded(): Promise<CalibrationNeededItem[]> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    return getCalibrationNeededFromHistory(schema.history, todayKey);
  }

  /**
   * Add a new challenge to the current day's challenges.
   * Idempotent: no-op if the challenge already exists in today's record.
   * Creates the daily record if it doesn't exist yet.
   * Used when regenerating a challenge after skip, or registering a custom
   * challenge that was opened directly via URL (not pre-loaded from focus plan).
   */
  async addChallenge(
    dateKey: string,
    newChallenge: DailyChallenge
  ): Promise<void> {
    if (!isTodayDateKey(dateKey)) {
      log.warn('Cannot add challenge outside of today', { dateKey, newChallengeId: newChallenge.id });
      return;
    }
    const schema = await this.getStorage();
    const result = addChallengeToHistory(schema.history, dateKey, newChallenge);

    if (result === 'duplicate') {
      log.debug('Challenge already registered (idempotent)', { dateKey, challengeId: newChallenge.id });
      return;
    }

    await this.setStorage(schema);
    log.debug('Challenge added', { dateKey, newChallengeId: newChallenge.id });
  }

  /**
   * Add a new goal to the current day's goals.
   * Used when regenerating a goal after skip.
   */
  async addGoal(
    dateKey: string,
    newGoal: DailyGoal
  ): Promise<void> {
    if (!isTodayDateKey(dateKey)) {
      log.warn('Cannot add goal outside of today', { dateKey, newGoalId: newGoal.id });
      return;
    }
    const schema = await this.getStorage();
    const added = addGoalToHistory(schema.history, dateKey, newGoal);

    if (!added) {
      log.warn('Attempted to add goal for non-existent date', { dateKey });
      return;
    }

    await this.setStorage(schema);
    log.debug('Goal added', { dateKey, newGoalId: newGoal.id });
  }
}

export const focusStore = new LocalStorageFocusStore();
