/**
 * Active Operations Manager
 *
 * Singleton tracking long-running AI operations (topic / challenge / goal
 * regenerations, chat responses) backed by the /api/jobs queue.
 *
 * @remarks
 * Wire-level polling lives in {@link pollJobUntilTerminal}; backend
 * restoration lives in {@link fetchActiveJobEntries}; snapshot caching
 * lives in {@link buildOperationState}. This file is the orchestrator.
 */

import { apiDelete, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import {
  completeClientTriggerMetadata,
  type PartialClientTriggerMetadata,
} from '@/lib/observability/job-trigger-builders';
import { now } from '@/lib/utils/date-utils';

import { activeOperationsStore, type ActiveOperationItemType } from './active-operations-store';
import { completeExistingChatJob, registerExistingChatJob } from './chat-job-registry';
import { pollJobUntilTerminal } from './job-poller';
import type { JobResponse } from './job-types';
import { buildJobPollCallbacks } from './operation-poll-callbacks';
import { buildOperationState } from './operation-results';
import { fetchActiveJobEntries } from './restore-active-jobs';
import type {
  ActiveOperation,
  OperationsListener,
  OperationsSnapshot,
  OperationStatus,
  OperationType,
} from './types';

const log = logger.withTag('OperationsManager');

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_TIME_MS = 120000;

interface BackgroundJobOptions<T> {
  type: 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'chat-response';
  targetId: string;
  input: Record<string, unknown>;
  clientTrigger?: PartialClientTriggerMetadata;
  onComplete?: (result: T) => void | Promise<void>;
  onError?: (error: Error) => void;
}

const JOB_ITEM_TYPE_BY_TYPE: Partial<Record<OperationType, ActiveOperationItemType>> = {
  'topic-regeneration': 'topic',
  'challenge-regeneration': 'challenge',
  'goal-regeneration': 'goal',
  'chat-response': 'chat',
};

const ITEM_TYPE_TO_JOB_TYPE: Record<ActiveOperationItemType, OperationType> = {
  topic: 'topic-regeneration',
  challenge: 'challenge-regeneration',
  goal: 'goal-regeneration',
  chat: 'chat-response',
};

class ActiveOperationsManager {
  private operations = new Map<string, ActiveOperation>();
  private listeners = new Set<OperationsListener>();
  private cachedSnapshot: OperationsSnapshot = {
    topicRegenerations: new Map(),
    challengeRegenerations: new Map(),
    goalRegenerations: new Map(),
    chatMessages: new Map(),
    hydrated: false,
  };
  private cachedActiveIds = {
    topics: new Set<string>(),
    challenges: new Set<string>(),
    goals: new Set<string>(),
    chat: new Set<string>(),
  };

  /** Active stop-poller callbacks keyed by job ID. */
  private pollStoppers = new Map<string, () => void>();
  private jobToOperation = new Map<string, string>();
  private initialized = false;
  /**
   * Flipped after the first initialize() pass so the snapshot's
   * `hydrated` flag can transition; downstream consumers (chat hook)
   * gate stale-stream cleanup on it.
   */
  private isHydrated = false;
  private completionHandlers = new Map<
    string,
    (result: unknown, targetId: string) => Promise<void>
  >();

  registerCompletionHandler(
    jobType: string,
    handler: (result: unknown, targetId: string) => Promise<void>,
  ): void {
    this.completionHandlers.set(jobType, handler);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const entries = await fetchActiveJobEntries((error) => {
      log.warn('Failed to fetch active jobs from API:', error);
    });

    if (entries.length > 0) {
      log.info(`Found ${entries.length} active jobs on init`);
    }

    for (const entry of entries) {
      const jobType = ITEM_TYPE_TO_JOB_TYPE[entry.itemType];
      const operationId = `${jobType}:${entry.itemId}`;
      if (this.operations.has(operationId)) continue;

      this.operations.set(operationId, {
        id: operationId,
        status: 'in-progress',
        meta: {
          type: jobType,
          startedAt: entry.startedAt,
          targetId: entry.itemId,
          jobId: entry.jobId,
          assistantMessageId: entry.assistantMessageId,
        },
      });
      this.jobToOperation.set(entry.jobId, operationId);

      // Chat operations stream over SSE; per-job polling is intentionally
      // skipped to avoid duplicating transport. The SSE hook clears the
      // op via `completeExistingJob` on terminal events.
      if (jobType !== 'chat-response') {
        this.beginPolling(entry.jobId, operationId);
      }
    }

    this.isHydrated = true;
    this.updateSnapshot();
    this.notifyListeners();
  }

  async startBackgroundJob<T>(options: BackgroundJobOptions<T>): Promise<string | null> {
    const { type, targetId, input, clientTrigger, onComplete, onError } = options;

    try {
      const triggerMetadata = completeClientTriggerMetadata(clientTrigger, targetId);
      const response = await apiPost<JobResponse>(
        '/api/jobs',
        { type, targetId, input },
        { clientTrigger: triggerMetadata },
      );

      if (!response?.id) {
        throw new Error('Failed to create background job');
      }

      const jobId = response.id;
      const operationId = `${type}:${targetId}`;

      log.info(`Created background job: ${jobId} for ${operationId}`);

      this.jobToOperation.set(jobId, operationId);
      this.operations.set(operationId, {
        id: operationId,
        status: 'in-progress',
        meta: { type: type as OperationType, startedAt: now(), targetId, jobId },
      });
      this.updateSnapshot();
      this.notifyListeners();

      const itemType = JOB_ITEM_TYPE_BY_TYPE[type as OperationType];
      if (itemType) {
        activeOperationsStore
          .addEntry({ itemId: targetId, itemType, jobId, startedAt: now() })
          .catch((err) => {
            log.warn('Failed to persist active operation entry', { err, jobId, operationId });
          });
      }

      this.beginPolling(
        jobId,
        operationId,
        onComplete as ((result: unknown) => void | Promise<void>) | undefined,
        onError,
      );

      return operationId;
    } catch (error) {
      log.error('Failed to start background job:', error);
      onError?.(error as Error);
      return null;
    }
  }

  private beginPolling(
    jobId: string,
    operationId: string,
    onComplete?: (result: unknown) => void | Promise<void>,
    onError?: (error: Error) => void,
  ): void {
    const stop = pollJobUntilTerminal(
      { jobId, intervalMs: POLL_INTERVAL_MS, timeoutMs: MAX_POLL_TIME_MS },
      buildJobPollCallbacks(
        jobId,
        operationId,
        {
          releasePoller: (id) => this.releasePoller(id),
          markCompleted: (id, result) => {
            const op = this.operations.get(id);
            if (!op) return;
            op.status = 'complete';
            op.result = result;
            this.updateSnapshot();
            this.notifyListeners();
          },
          markFailed: (id, error) => this.updateStatus(id, 'failed', error),
          cleanup: (id) => this.cleanup(id),
          runCompletionHandler: (job) => this.runCompletionHandler(job),
        },
        onComplete,
        onError,
      ),
    );

    this.pollStoppers.set(jobId, stop);
  }

  private async runCompletionHandler(job: JobResponse): Promise<void> {
    if (!job.result || !job.targetId) return;
    const handler = this.completionHandlers.get(job.type);
    if (!handler) return;
    try {
      await handler(job.result, job.targetId);
      log.info(`Registered handler completed for ${job.type}`);
    } catch (err) {
      log.error('Registered completion handler failed:', err);
    }
  }

  private releasePoller(jobId: string): void {
    const stop = this.pollStoppers.get(jobId);
    if (stop) {
      stop();
      this.pollStoppers.delete(jobId);
    }
    this.jobToOperation.delete(jobId);
    void this.removeActiveEntry(jobId);
  }

  abort(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) return false;

    if (operation.abortController) {
      operation.abortController.abort();
    }
    operation.status = 'aborted';
    this.updateSnapshot();
    this.notifyListeners();
    log.debug(`Aborted operation: ${operationId}`);
    setTimeout(() => this.cleanup(operationId), 100);
    return true;
  }

  isActive(operationId: string): boolean {
    return this.operations.get(operationId)?.status === 'in-progress';
  }

  hasActiveOfType(type: OperationType): boolean {
    for (const op of this.operations.values()) {
      if (op.meta.type === type && op.status === 'in-progress') return true;
    }
    return false;
  }

  getActiveIdsOfType(type: OperationType): Set<string> {
    switch (type) {
      case 'topic-regeneration':
        return this.cachedActiveIds.topics;
      case 'challenge-regeneration':
        return this.cachedActiveIds.challenges;
      case 'goal-regeneration':
        return this.cachedActiveIds.goals;
      case 'chat-response':
        return this.cachedActiveIds.chat;
      default:
        return new Set();
    }
  }

  get(operationId: string): ActiveOperation | undefined {
    return this.operations.get(operationId);
  }

  getSnapshot(): OperationsSnapshot {
    return this.cachedSnapshot;
  }

  subscribe(listener: OperationsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateSnapshot(): void {
    const state = buildOperationState(this.operations, this.isHydrated);
    this.cachedSnapshot = state.snapshot;
    this.cachedActiveIds = state.activeIds;
  }

  private updateStatus(operationId: string, status: OperationStatus, error?: string): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    operation.status = status;
    if (error) operation.error = error;
    this.updateSnapshot();
    this.notifyListeners();
  }

  private cleanup(operationId: string): void {
    if (this.operations.delete(operationId)) {
      this.updateSnapshot();
      this.notifyListeners();
      log.debug(`Cleaned up operation: ${operationId}`);
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Listener errors are isolated so one bad subscriber can't
        // block the others (mirrors React's snapshot store contract).
      }
    });
  }

  getActiveChatJobForThread(threadId: string): ActiveOperation | undefined {
    for (const op of this.operations.values()) {
      if (
        op.meta.type === 'chat-response' &&
        op.meta.targetId === threadId &&
        op.status === 'in-progress'
      ) {
        return op;
      }
    }
    return undefined;
  }

  hasActiveChatJob(threadId: string): boolean {
    return this.getActiveChatJobForThread(threadId) !== undefined;
  }

  async cancelBackgroundJob(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'in-progress') {
      log.debug(`Cancel request for ${operationId}: operation not found or not in-progress`);
      return false;
    }

    log.info(`Cancelling background job: ${operationId}`);

    const jobId = operation.meta.jobId;
    if (jobId) {
      this.releasePoller(jobId);
      log.info(`[Job ${jobId}] Stopped client-side polling`);
      try {
        log.info(`[Job ${jobId}] Sending cancellation request to server...`);
        const response = await apiDelete(`/api/jobs/${jobId}`);
        log.info(`[Job ${jobId}] Server cancellation response:`, response);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to cancel on server (may have completed):`, err);
      }
    }

    operation.status = 'aborted';
    this.updateSnapshot();
    this.notifyListeners();
    log.info(`Cancelled background job: ${operationId}`);
    setTimeout(() => this.cleanup(operationId), 100);
    return true;
  }

  async cancelChatJobForThread(threadId: string): Promise<boolean> {
    const operation = this.getActiveChatJobForThread(threadId);
    if (!operation) return false;
    return this.cancelBackgroundJob(`chat-response:${threadId}`);
  }

  private async removeActiveEntry(jobId: string): Promise<void> {
    try {
      await activeOperationsStore.removeByJobId(jobId);
    } catch (error) {
      log.warn('Failed to remove active operation entry', { error, jobId });
    }
  }

  /**
   * Track a job created outside `startBackgroundJob` (e.g. the chat
   * stream path, which posts to /api/jobs directly because polling is
   * undesirable). Idempotent on `operationId`.
   */
  registerExistingJob(
    jobId: string,
    type: OperationType,
    targetId: string,
    assistantMessageId?: string,
  ): void {
    registerExistingChatJob(
      this.chatRegistryState(),
      (t) => JOB_ITEM_TYPE_BY_TYPE[t],
      jobId,
      type,
      targetId,
      assistantMessageId,
    );
  }

  /**
   * Tear down an SSE-tracked chat op when its stream terminates.
   * Safe to call with an unknown jobId.
   */
  completeExistingJob(jobId: string): void {
    completeExistingChatJob(this.chatRegistryState(), jobId);
  }

  private chatRegistryState() {
    return {
      operations: this.operations,
      jobToOperation: this.jobToOperation,
      onChange: () => {
        this.updateSnapshot();
        this.notifyListeners();
      },
    };
  }
}

export const operationsManager = new ActiveOperationsManager();
