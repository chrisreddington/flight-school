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
import { getDateKey } from '@/lib/utils/date-utils';
import {
  createStatefulChallenge,
  createStatefulGoal,
  createStatefulTopic,
  transitionChallengeState,
  transitionGoalState,
  transitionTopicState,
  getCurrentChallengeState,
  getCurrentGoalState,
  type ChallengeState,
  type GoalState,
  type TopicState,
} from './state-machine';
import type {
    CalibrationNeededItem,
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
   */
  async transitionChallenge(
    dateKey: string,
    challengeId: string,
    newState: ChallengeState,
    source?: string
  ): Promise<void> {
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

    try {
      // Use state machine to transition
      const currentChallenge = record.challenges[index];
      const currentState = getCurrentChallengeState(currentChallenge);
      
      // Prevent skipping completed challenges
      if (currentState === 'completed' && newState === 'skipped') {
        log.warn('Cannot skip completed challenge', { dateKey, challengeId });
        return;
      }

      const updated = transitionChallengeState(currentChallenge, newState, source);
      record.challenges[index] = updated;
      
      await this.setStorage(schema);
      log.debug('Challenge state transitioned', { dateKey, challengeId, newState, source });
    } catch (error) {
      log.error('Invalid challenge state transition', { dateKey, challengeId, newState, error });
    }
  }

  /**
   * Transition goal to a new state.
   * Uses state machine to validate transitions.
   */
  async transitionGoal(
    dateKey: string,
    goalId: string,
    newState: GoalState,
    source?: string
  ): Promise<void> {
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

    try {
      // Use state machine to transition
      const currentGoal = record.goals[index];
      const currentState = getCurrentGoalState(currentGoal);
      
      // Prevent skipping completed goals
      if (currentState === 'completed' && newState === 'skipped') {
        log.warn('Cannot skip completed goal', { dateKey, goalId });
        return;
      }

      const updated = transitionGoalState(currentGoal, newState, source);
      record.goals[index] = updated;
      
      await this.setStorage(schema);
      log.debug('Goal state transitioned', { dateKey, goalId, newState, source });
    } catch (error) {
      log.error('Invalid goal state transition', { dateKey, goalId, newState, error });
    }
  }

  /**
   * Mark a learning topic as explored or skipped.
   * Uses state machine to validate transitions.
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
    let found = false;
    for (let i = 0; i < record.learningTopics.length; i++) {
      const topicArray = record.learningTopics[i];
      const topicIndex = topicArray.findIndex(t => t.data.id === topicId);
      
      if (topicIndex !== -1) {
        try {
          const updated = transitionTopicState(topicArray[topicIndex], 'explored', source);
          record.learningTopics[i][topicIndex] = updated;
          found = true;
          break;
        } catch (error) {
          log.error('Invalid topic state transition', { dateKey, topicId, error });
          return;
        }
      }
    }

    if (found) {
      await this.setStorage(schema);
      log.debug('Topic marked as explored', { dateKey, topicId, source });
    } else {
      log.warn('Topic not found in record', { dateKey, topicId });
    }
  }

  /**
   * Transition a topic to a new state (explored or skipped).
   */
  async transitionTopic(
    dateKey: string,
    topicId: string,
    newState: TopicState,
    source?: string
  ): Promise<void> {
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record) {
      log.warn('Attempted to transition topic for non-existent date', { dateKey, topicId });
      return;
    }

    // Find and update the topic (topics are nested in arrays)
    let found = false;
    for (let i = 0; i < record.learningTopics.length; i++) {
      const topicArray = record.learningTopics[i];
      const topicIndex = topicArray.findIndex(t => t.data.id === topicId);
      
      if (topicIndex !== -1) {
        try {
          const updated = transitionTopicState(topicArray[topicIndex], newState, source);
          record.learningTopics[i][topicIndex] = updated;
          found = true;
          break;
        } catch (error) {
          log.error('Invalid topic state transition', { dateKey, topicId, newState, error });
          return;
        }
      }
    }

    if (found) {
      await this.setStorage(schema);
      log.debug('Topic transitioned', { dateKey, topicId, newState, source });
    } else {
      log.warn('Topic not found in record', { dateKey, topicId });
    }
  }

  /**
   * Add a new topic to the current day's most recent topics array.
   * Used when regenerating a topic - keeps the skipped one and adds the new one.
   */
  async addTopic(
    dateKey: string,
    newTopic: LearningTopic
  ): Promise<void> {
    const schema = await this.getStorage();
    const record = schema.history[dateKey];
    
    if (!record || record.learningTopics.length === 0) {
      log.warn('Attempted to add topic for non-existent date or empty topics', { dateKey });
      return;
    }

    // Work with the MOST RECENT topics array (last one)
    const lastTopicsIndex = record.learningTopics.length - 1;
    
    // Create new stateful topic and append to the array
    const statefulNewTopic = createStatefulTopic(newTopic);
    record.learningTopics[lastTopicsIndex].push(statefulNewTopic);

    await this.setStorage(schema);
    log.debug('Topic added', { dateKey, newTopicId: newTopic.id });
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
}

export const focusStore = new LocalStorageFocusStore();
