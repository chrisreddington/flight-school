/**
 * Chat-job registration helpers for the operations manager.
 *
 * Chat operations stream over SSE rather than poll, so the chat hook
 * creates the /api/jobs entry directly and asks the manager to track it.
 * These helpers encapsulate that registration / teardown without the
 * manager class needing to grow more methods.
 */

import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';

import { activeOperationsStore, type ActiveOperationItemType } from './active-operations-store';
import type { ActiveOperation, OperationType } from './types';

const log = logger.withTag('ChatJobRegistry');

/**
 * State surface the registry needs from the manager. Kept narrow so the
 * manager can hand over only what's strictly required.
 */
export interface ChatJobRegistryState {
  operations: Map<string, ActiveOperation>;
  jobToOperation: Map<string, string>;
  onChange: () => void;
}

/**
 * Track a job created outside the normal `startBackgroundJob` path.
 * Idempotent on `operationId` — re-registering refreshes the jobId
 * mapping rather than producing a duplicate.
 */
export function registerExistingChatJob(
  state: ChatJobRegistryState,
  itemTypeFor: (type: OperationType) => ActiveOperationItemType | undefined,
  jobId: string,
  type: OperationType,
  targetId: string,
  assistantMessageId?: string,
): void {
  const operationId = `${type}:${targetId}`;
  const existing = state.operations.get(operationId);

  if (existing) {
    // When a new job replaces an older one for the same target
    // (user sends a second message before cleanup finished), drop
    // the stale mapping so SSE listeners don't keep targeting it.
    if (existing.meta.jobId && existing.meta.jobId !== jobId) {
      state.jobToOperation.delete(existing.meta.jobId);
    }
    existing.meta = {
      ...existing.meta,
      jobId,
      startedAt: now(),
      // Preserve a previously-set assistantMessageId; losing it would
      // key the chat-stream-store on an empty id and the UI would
      // refuse to render the streaming bubble.
      assistantMessageId: assistantMessageId ?? existing.meta.assistantMessageId,
    };
    existing.status = 'in-progress';
  } else {
    state.operations.set(operationId, {
      id: operationId,
      status: 'in-progress',
      meta: { type, startedAt: now(), targetId, jobId, assistantMessageId },
    });
  }
  state.jobToOperation.set(jobId, operationId);

  const itemType = itemTypeFor(type);
  if (itemType) {
    const op = state.operations.get(operationId);
    activeOperationsStore
      .addEntry({
        itemId: targetId,
        itemType,
        jobId,
        startedAt: op?.meta.startedAt ?? now(),
        assistantMessageId: op?.meta.assistantMessageId,
      })
      .catch((err) => {
        log.warn('Failed to persist active operation entry', { err, jobId, operationId });
      });
  }

  state.onChange();
}

/**
 * Tear down an SSE-tracked chat op when its stream terminates.
 * Safe to call with an unknown jobId (drops only the persisted entry).
 */
export function completeExistingChatJob(state: ChatJobRegistryState, jobId: string): void {
  const operationId = state.jobToOperation.get(jobId);
  if (operationId) {
    state.operations.delete(operationId);
    state.jobToOperation.delete(jobId);
    void removeActiveEntry(jobId);
    state.onChange();
  } else {
    // Drop the persisted entry even when the in-memory op is unknown
    // so the next initialize() doesn't resurrect a finished stream.
    void removeActiveEntry(jobId);
  }
}

async function removeActiveEntry(jobId: string): Promise<void> {
  try {
    await activeOperationsStore.removeByJobId(jobId);
  } catch (error) {
    log.warn('Failed to remove active operation entry', { error, jobId });
  }
}
