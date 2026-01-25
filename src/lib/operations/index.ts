/**
 * Operations Module
 *
 * Manages long-running AI operations that should continue independently
 * of React component lifecycle.
 */

import { operationsManager } from './active-operations';

export { operationsManager };
export type {
  ActiveOperation,
  OperationMeta,
  OperationsListener,
  OperationsSnapshot,
  OperationStatus,
  OperationType,
  StartOperationOptions,
} from './types';

/**
 * Event name for notifying React components that focus data has changed.
 * Dispatch this after persisting focus data to trigger UI refresh.
 */
export const FOCUS_DATA_CHANGED_EVENT = 'focus-data-changed';

/**
 * Dispatch focus data changed event to notify all listeners.
 * Call this after successfully persisting focus data.
 */
function notifyFocusDataChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(FOCUS_DATA_CHANGED_EVENT));
  }
}

// Register completion handlers at module load time
// This ensures handlers are available even when React components are unmounted
import { focusStore } from '@/lib/focus';
import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';

const log = logger.withTag('OperationsHandlers');

// Topic regeneration handler - persists new topic when job completes
operationsManager.registerCompletionHandler(
  'topic-regeneration',
  async (result: unknown, targetId: string) => {
    const typedResult = result as { learningTopic?: LearningTopic };
    if (!typedResult?.learningTopic) {
      log.warn('Topic regeneration completed but no topic returned');
      return;
    }
    
    const dateKey = getDateKey();
    if (!isTodayDateKey(dateKey)) {
      log.warn('Topic regeneration completed for non-today date', { targetId, dateKey });
      return;
    }
    const position = await focusStore.getTopicPosition(dateKey, targetId);

    // Mark the original topic as skipped (keeps it in history)
    await focusStore.transitionTopic(dateKey, targetId, 'skipped', 'dashboard');

    // Add the new topic to the list (don't replace - keep full history)
    await focusStore.addTopic(dateKey, typedResult.learningTopic, position ?? undefined);
    log.info(`Topic added via registered handler: ${typedResult.learningTopic.id} (skipped: ${targetId})`);
    
    // Notify React components that focus data has changed
    notifyFocusDataChanged();
  }
);

operationsManager.registerCompletionHandler(
  'challenge-regeneration',
  async (result: unknown, targetId: string) => {
    const typedResult = result as { challenge?: DailyChallenge };
    if (!typedResult?.challenge) {
      log.warn('Challenge regeneration completed but no challenge returned');
      return;
    }

    const dateKey = getDateKey();
    if (!isTodayDateKey(dateKey)) {
      log.warn('Challenge regeneration completed for non-today date', { targetId, dateKey });
      return;
    }

    await focusStore.transitionChallenge(dateKey, targetId, 'skipped', 'dashboard');
    await focusStore.addChallenge(dateKey, typedResult.challenge);
    log.info(`Challenge added via registered handler: ${typedResult.challenge.id} (skipped: ${targetId})`);
    
    // Notify React components that focus data has changed
    notifyFocusDataChanged();
  }
);

operationsManager.registerCompletionHandler(
  'goal-regeneration',
  async (result: unknown, targetId: string) => {
    const typedResult = result as { goal?: DailyGoal };
    if (!typedResult?.goal) {
      log.warn('Goal regeneration completed but no goal returned');
      return;
    }

    const dateKey = getDateKey();
    if (!isTodayDateKey(dateKey)) {
      log.warn('Goal regeneration completed for non-today date', { targetId, dateKey });
      return;
    }

    await focusStore.transitionGoal(dateKey, targetId, 'skipped', 'dashboard');
    await focusStore.addGoal(dateKey, typedResult.goal);
    log.info(`Goal added via registered handler: ${typedResult.goal.id} (skipped: ${targetId})`);
    
    // Notify React components that focus data has changed
    notifyFocusDataChanged();
  }
);
