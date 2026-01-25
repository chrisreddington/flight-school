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

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import {
  createStatefulChallenge,
  createStatefulGoal,
  createStatefulTopic,
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
import { MAX_HISTORY_ENTRIES } from './types';

const log = logger.withTag('FocusStore');

/**
 * Deep equality check for generic objects.
 * Used to deduplicate focus components.
 */
function isEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// =============================================================================
// FocusStore Class
// =============================================================================

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
  /** Transition topic to new state (explored or skipped) */
  transitionTopic(dateKey: string, topicId: string, newState: TopicState, source?: string): Promise<void>;
  /** Replace a topic in the current day's topics (for regeneration) */
  replaceTopic(dateKey: string, oldTopicId: string, newTopic: LearningTopic): Promise<void>;
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
    if (typeof window === 'undefined') {
      return { history: {} };
    }

    try {
      const schema = await apiGet<FocusStorageSchema>('/api/focus/storage');
      return schema;
    } catch (error) {
      log.error('Failed to load focus storage, using empty schema', error);
      return { history: {} };
    }
  }

  private async setStorage(schema: FocusStorageSchema): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      await apiPost<void>('/api/focus/storage', schema);
    } catch (error) {
      log.error('Failed to save to storage', { error });
      throw error;
    }
  }

  private pruneHistory(history: FocusHistory): FocusHistory {
    const entries = Object.entries(history);
    if (entries.length <= MAX_HISTORY_ENTRIES) {
      return history;
    }
    const sorted = entries.sort(([a], [b]) => b.localeCompare(a));
    const pruned = sorted.slice(0, MAX_HISTORY_ENTRIES);
    return Object.fromEntries(pruned);
  }

  /**
   * Reconstructs the current view of the day's focus from the latest components.
   */
  async getTodaysFocus(): Promise<FocusResponse | null> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    const record = schema.history[todayKey];
    
    if (!record || 
        record.challenges.length === 0 || 
        record.goals.length === 0 || 
        record.learningTopics.length === 0) {
      return null;
    }
    
    // Get latest version of each component
    const latestChallenge = record.challenges[record.challenges.length - 1];
    const latestGoal = record.goals[record.goals.length - 1];
    const latestTopics = record.learningTopics[record.learningTopics.length - 1];

    // Safety check: ensure items have stateHistory (handle old data format)
    if (!latestChallenge.stateHistory || !latestGoal.stateHistory || !latestTopics[0]?.stateHistory) {
      return null; // Old format - will be reset on schema mismatch
    }

    // Get generated timestamp from first state transition
    const challengeGenerated = latestChallenge.stateHistory[0].timestamp;
    const goalGenerated = latestGoal.stateHistory[0].timestamp;
    const topicsGenerated = latestTopics[0].stateHistory[0].timestamp;
    
    const timestamps = [challengeGenerated, goalGenerated, topicsGenerated].sort();
    const latestGeneratedAt = timestamps[timestamps.length - 1];

    return {
        challenge: latestChallenge.data,
        goal: latestGoal.data,
        learningTopics: latestTopics.map(t => t.data),
        calibrationNeeded: record.calibrationNeeded,
        meta: {
            generatedAt: latestGeneratedAt,
            aiEnabled: true, 
            model: 'stored',
            toolsUsed: [],
            totalTimeMs: 0,
            usedCachedProfile: true
        }
    };
  }

  /**
   * Decomposes and saves the focus response.
   * Creates stateful items with initial states.
   */
  async saveTodaysFocus(focus: FocusResponse): Promise<void> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();

    // Initialize daily record if needed
    if (!schema.history[todayKey]) {
      schema.history[todayKey] = {
        challenges: [],
        goals: [],
        learningTopics: []
      };
    }
    const record = schema.history[todayKey];

    // Helper to check if an item has valid content (not empty placeholders)
    const isValidChallenge = focus.challenge?.id && focus.challenge?.title;
    const isValidGoal = focus.goal?.id && focus.goal?.title;
    const hasValidTopics = focus.learningTopics?.length > 0 && 
      focus.learningTopics.every(t => t.id && t.title);

    // 1. Append Challenge if different AND valid
    if (isValidChallenge) {
      const lastChallenge = record.challenges[record.challenges.length - 1];
      if (!lastChallenge || !isEqual(lastChallenge.data, focus.challenge)) {
          const statefulChallenge = createStatefulChallenge(focus.challenge);
          record.challenges.push(statefulChallenge);
      }
    }

    // 2. Append Goal if different AND valid
    if (isValidGoal) {
      const lastGoal = record.goals[record.goals.length - 1];
      if (!lastGoal || !isEqual(lastGoal.data, focus.goal)) {
          const statefulGoal = createStatefulGoal(focus.goal);
          record.goals.push(statefulGoal);
      }
    }

    // 3. Append Topics if different AND valid
    if (hasValidTopics) {
      const lastTopics = record.learningTopics[record.learningTopics.length - 1];
      const topicsChanged = !lastTopics || !isEqual(
        lastTopics.map(t => t.data),
        focus.learningTopics
      );
      
      if (topicsChanged) {
          const statefulTopics = focus.learningTopics.map(topic => 
            createStatefulTopic(topic)
          );
          record.learningTopics.push(statefulTopics);
      }
    }

    // 4. Save calibration items (merge with existing, avoiding duplicates)
    if (focus.calibrationNeeded && focus.calibrationNeeded.length > 0) {
      const existingIds = new Set(record.calibrationNeeded?.map(c => c.skillId) || []);
      const newItems = focus.calibrationNeeded.filter(c => !existingIds.has(c.skillId));
      record.calibrationNeeded = [...(record.calibrationNeeded || []), ...newItems];
    }

    // Prune old days
    schema.history = this.pruneHistory(schema.history);
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
    if (typeof window === 'undefined') {
      return;
    }
    try {
      await apiDelete<void>('/api/focus/storage');
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
      log.error('Goal state transition failed', { dateKey, goalId, currentState, newState, error });
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
          log.error('Topic state transition failed', { dateKey, topicId, currentState, targetState: 'explored', error });
        }
        return;
      }
    }

    log.warn('Topic not found in record', { dateKey, topicId });
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
          log.error('Topic state transition failed', { dateKey, topicId, currentState, newState, error });
        }
        return;
      }
    }

    log.warn('Topic not found in record', { dateKey, topicId });
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

    // Work with the MOST RECENT topics array (last one)
    const lastTopicsIndex = record.learningTopics.length - 1;
    const topicArray = record.learningTopics[lastTopicsIndex];
    
    // Count active topics (not skipped) before this topic
    let activePosition = 0;
    for (const statefulTopic of topicArray) {
      if (statefulTopic.data.id === topicId) {
        log.debug('Found topic position', { dateKey, topicId, activePosition });
        return activePosition;
      }
      
      // Only count non-skipped topics towards position
      const lastState = statefulTopic.stateHistory[statefulTopic.stateHistory.length - 1]?.state;
      if (lastState !== 'skipped') {
        activePosition++;
      }
    }
    
    log.warn('Topic not found for position lookup', { dateKey, topicId });
    return null;
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

    // Work with the MOST RECENT topics array (last one)
    const lastTopicsIndex = record.learningTopics.length - 1;
    
    // Create new stateful topic
    const statefulNewTopic = createStatefulTopic(newTopic);
    
    // Insert at position or append
    if (position !== undefined && position >= 0 && position <= record.learningTopics[lastTopicsIndex].length) {
      // Insert at specific position for in-place replacement
      record.learningTopics[lastTopicsIndex].splice(position, 0, statefulNewTopic);
      log.debug('Topic inserted at position', { dateKey, newTopicId: newTopic.id, position });
    } else {
      // Append to end (default behavior)
      record.learningTopics[lastTopicsIndex].push(statefulNewTopic);
      log.debug('Topic added', { dateKey, newTopicId: newTopic.id });
    }

    await this.setStorage(schema);
  }

  /**
   * @deprecated Use addTopic instead - we want to keep history of all topics
   * Replace a topic in the current day's most recent topics array.
   */
  async replaceTopic(
    dateKey: string,
    oldTopicId: string,
    newTopic: LearningTopic
  ): Promise<void> {
    // Just add the new topic - old one should already be marked skipped
    await this.addTopic(dateKey, newTopic);
  }

  /**
   * Remove a calibration item when user confirms or dismisses it.
   */
  async removeCalibrationItem(skillId: string): Promise<void> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    const record = schema.history[todayKey];

    if (!record || !record.calibrationNeeded) {
      return;
    }

    record.calibrationNeeded = record.calibrationNeeded.filter(
      item => item.skillId !== skillId
    );

    await this.setStorage(schema);
    log.debug('Calibration item removed', { skillId });
  }

  /**
   * Get pending calibration items for today.
   */
  async getCalibrationNeeded(): Promise<CalibrationNeededItem[]> {
    const schema = await this.getStorage();
    const todayKey = getDateKey();
    const record = schema.history[todayKey];

    return record?.calibrationNeeded || [];
  }

  /**
   * Add a new challenge to the current day's challenges.
   * Used when regenerating a challenge after skip.
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
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to add challenge for non-existent date', { dateKey });
      return;
    }

    // Create new stateful challenge and append
    const statefulChallenge = createStatefulChallenge(newChallenge);
    record.challenges.push(statefulChallenge);

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
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to add goal for non-existent date', { dateKey });
      return;
    }

    // Create new stateful goal and append
    const statefulGoal = createStatefulGoal(newGoal);
    record.goals.push(statefulGoal);

    await this.setStorage(schema);
    log.debug('Goal added', { dateKey, newGoalId: newGoal.id });
  }
}

export const focusStore = new LocalStorageFocusStore();
