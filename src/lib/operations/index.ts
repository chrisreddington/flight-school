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

// Register completion handlers at module load time
// This ensures handlers are available even when React components are unmounted
import { focusStore } from '@/lib/focus';
import { getDateKey } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';
import type { LearningTopic } from '@/lib/focus/types';

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
    
    // Mark the original topic as skipped (keeps it in history)
    await focusStore.transitionTopic(dateKey, targetId, 'skipped', 'dashboard');
    
    // Add the new topic to the list (don't replace - keep full history)
    await focusStore.addTopic(dateKey, typedResult.learningTopic);
    log.info(`Topic added via registered handler: ${typedResult.learningTopic.id} (skipped: ${targetId})`);
  }
);
