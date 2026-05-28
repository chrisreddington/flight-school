/**
 * Focus Storage
 *
 * Server-backed persistence for the user's Daily Focus content. The
 * class is a thin read-mutate-write coordinator: all mutation logic
 * lives in `storage-transitions.ts` and `storage-mutations.ts` so each
 * file stays under its size budget and each concern can be tested in
 * isolation.
 *
 * @remarks
 * Data is stored server-side at `.data/focus-storage.json` via
 * `/api/focus/storage`.
 */

import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';

import { getTodaysFocusFromHistory, saveFocusToHistory } from './history';
import { clearFocusStorage, readFocusStorage, writeFocusStorage } from './persistence';
import type { ChallengeState, GoalState, TopicState } from './state-machine';
import {
  applyAddChallenge,
  applyAddGoal,
  applyAddTopic,
  applyRemoveCalibrationItem,
  readCalibrationNeeded,
  readTopicPosition,
} from './storage-mutations';
import {
  applyChallengeTransition,
  applyGoalTransition,
  applySelfExplanation,
  applyTopicReplaced,
  applyTopicReviewed,
  applyTopicTransition,
} from './storage-transitions';
import type {
  CalibrationNeededItem,
  DailyChallenge,
  DailyGoal,
  FocusHistory,
  FocusResponse,
  FocusStorageSchema,
  LearningTopic,
} from './types';

const log = logger.withTag('FocusStore');

interface FocusStoreInterface {
  getTodaysFocus(): Promise<FocusResponse | null>;
  saveTodaysFocus(focus: FocusResponse): Promise<void>;
  saveCompleteFocusResponse(response: FocusResponse): Promise<void>;
  getHistory(): Promise<FocusHistory>;
  isNewDay(): Promise<boolean>;
  clear(): Promise<void>;
  clearTodaysFocus(): Promise<void>;
  transitionChallenge(dateKey: string, challengeId: string, newState: ChallengeState, source?: string): Promise<void>;
  transitionGoal(dateKey: string, goalId: string, newState: GoalState, source?: string): Promise<void>;
  markTopicExplored(dateKey: string, topicId: string, source?: string): Promise<void>;
  markTopicReviewed(dateKey: string, topicId: string): Promise<void>;
  transitionTopic(dateKey: string, topicId: string, newState: TopicState, source?: string): Promise<void>;
  saveSelfExplanation(dateKey: string, itemType: 'challenge' | 'topic', itemId: string, text: string): Promise<void>;
  markTopicReplaced(dateKey: string, oldTopicId: string, newTopicId: string): Promise<void>;
  removeCalibrationItem(skillId: string): Promise<void>;
  getCalibrationNeeded(): Promise<CalibrationNeededItem[]>;
  getTopicPosition(dateKey: string, topicId: string): Promise<number | null>;
  addTopic(dateKey: string, newTopic: LearningTopic, position?: number): Promise<void>;
  addChallenge(dateKey: string, newChallenge: DailyChallenge): Promise<void>;
  addGoal(dateKey: string, newGoal: DailyGoal): Promise<void>;
}

/**
 * Server-backed FocusStore implementation. Methods follow a
 * read-mutate-write pattern delegating to pure helpers in sibling
 * `storage-transitions.ts` / `storage-mutations.ts` files.
 */
class LocalStorageFocusStore implements FocusStoreInterface {
  private async getStorage(): Promise<FocusStorageSchema> {
    return readFocusStorage();
  }

  private async setStorage(schema: FocusStorageSchema): Promise<void> {
    await writeFocusStorage(schema);
  }

  /** Persist the schema only when the mutator reports a change occurred. */
  private async withSchema(mutate: (schema: FocusStorageSchema) => boolean): Promise<void> {
    const schema = await this.getStorage();
    if (mutate(schema)) {
      await this.setStorage(schema);
    }
  }

  async getTodaysFocus(): Promise<FocusResponse | null> {
    const schema = await this.getStorage();
    return getTodaysFocusFromHistory(schema.history, getDateKey());
  }

  async saveTodaysFocus(focus: FocusResponse): Promise<void> {
    const schema = await this.getStorage();
    schema.history = saveFocusToHistory(schema.history, getDateKey(), focus);
    await this.setStorage(schema);
  }

  async saveCompleteFocusResponse(response: FocusResponse): Promise<void> {
    await this.withSchema((schema) => {
      schema.history = saveFocusToHistory(schema.history, getDateKey(), response);
      return true;
    });
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

  async clearTodaysFocus(): Promise<void> {
    await this.withSchema((schema) => {
      const dateKey = getDateKey();
      if (!(dateKey in schema.history)) return false;
      delete schema.history[dateKey];
      return true;
    });
  }

  async transitionChallenge(
    dateKey: string,
    challengeId: string,
    newState: ChallengeState,
    source?: string,
  ): Promise<void> {
    return this.withSchema((schema) => applyChallengeTransition(schema, dateKey, challengeId, newState, source));
  }

  async transitionGoal(dateKey: string, goalId: string, newState: GoalState, source?: string): Promise<void> {
    return this.withSchema((schema) => applyGoalTransition(schema, dateKey, goalId, newState, source));
  }

  async markTopicExplored(dateKey: string, topicId: string, source?: string): Promise<void> {
    return this.withSchema((schema) => applyTopicTransition(schema, dateKey, topicId, 'explored', source));
  }

  async markTopicReviewed(dateKey: string, topicId: string): Promise<void> {
    return this.withSchema((schema) => applyTopicReviewed(schema, dateKey, topicId));
  }

  async transitionTopic(dateKey: string, topicId: string, newState: TopicState, source?: string): Promise<void> {
    return this.withSchema((schema) => applyTopicTransition(schema, dateKey, topicId, newState, source));
  }

  async saveSelfExplanation(
    dateKey: string,
    itemType: 'challenge' | 'topic',
    itemId: string,
    text: string,
  ): Promise<void> {
    return this.withSchema((schema) => applySelfExplanation(schema, dateKey, itemType, itemId, text));
  }

  async markTopicReplaced(dateKey: string, oldTopicId: string, newTopicId: string): Promise<void> {
    return this.withSchema((schema) => applyTopicReplaced(schema, dateKey, oldTopicId, newTopicId));
  }

  async removeCalibrationItem(skillId: string): Promise<void> {
    return this.withSchema((schema) => applyRemoveCalibrationItem(schema, skillId));
  }

  async getCalibrationNeeded(): Promise<CalibrationNeededItem[]> {
    const schema = await this.getStorage();
    return readCalibrationNeeded(schema);
  }

  async getTopicPosition(dateKey: string, topicId: string): Promise<number | null> {
    const schema = await this.getStorage();
    return readTopicPosition(schema, dateKey, topicId);
  }

  async addTopic(dateKey: string, newTopic: LearningTopic, position?: number): Promise<void> {
    return this.withSchema((schema) => applyAddTopic(schema, dateKey, newTopic, position));
  }

  async addChallenge(dateKey: string, newChallenge: DailyChallenge): Promise<void> {
    return this.withSchema((schema) => applyAddChallenge(schema, dateKey, newChallenge));
  }

  async addGoal(dateKey: string, newGoal: DailyGoal): Promise<void> {
    return this.withSchema((schema) => applyAddGoal(schema, dateKey, newGoal));
  }
}

export const focusStore = new LocalStorageFocusStore();
