/**
 * Active Operations Manager
 *
 * Singleton that manages long-running AI operations via backend job queue.
 * Operations continue running on the server even when user navigates away.
 *
 * @remarks
 * Uses a backend job queue pattern:
 * 1. Client POSTs to /api/jobs to create a job, gets back job ID immediately
 * 2. Server executes the AI operation asynchronously
 * 3. Client polls /api/jobs/[id] for status until complete
 * 4. Results are persisted server-side, retrieved on any page
 */

import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import {
  completeClientTriggerMetadata,
  type PartialClientTriggerMetadata,
} from '@/lib/observability/job-trigger-builders';
import { now } from '@/lib/utils/date-utils';
import { activeOperationsStore, type ActiveOperationItemType } from './active-operations-store';
import { getJobPollingDecision } from './job-polling';
import { buildOperationState } from './operation-results';
import type {
    ActiveOperation,
    OperationsListener,
    OperationsSnapshot,
    OperationStatus,
    OperationType,
} from './types';

const log = logger.withTag('OperationsManager');

/** Polling interval for job status (ms) */
const POLL_INTERVAL_MS = 1000;

/** Maximum time to poll before giving up (ms) */
const MAX_POLL_TIME_MS = 120000;

interface BackgroundJobOptions<T> {
  type: 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'chat-response';
  targetId: string;
  input: Record<string, unknown>;
  clientTrigger?: PartialClientTriggerMetadata;
  onComplete?: (result: T) => void | Promise<void>;
  onError?: (error: Error) => void;
}

interface JobResponse {
  id: string;
  type: string;
  targetId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
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
  /** All tracked operations by ID */
  private operations = new Map<string, ActiveOperation>();
  /** Subscribers to be notified on changes */
  private listeners = new Set<OperationsListener>();
  /** Cached snapshots for useSyncExternalStore (must be stable references) */
  private cachedSnapshot: OperationsSnapshot = {
    topicRegenerations: new Map(),
    challengeRegenerations: new Map(),
    goalRegenerations: new Map(),
    chatMessages: new Map(),
    hydrated: false,
  };

  /** Cached active IDs sets for useSyncExternalStore stability */
  private cachedActiveIds = {
    topics: new Set<string>(),
    challenges: new Set<string>(),
    goals: new Set<string>(),
    chat: new Set<string>(),
  };

  /** Active polling intervals by job ID */
  private pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  /** Job ID to operation ID mapping */
  private jobToOperation = new Map<string, string>();
  /** Whether we've initialized from backend */
  private initialized = false;
  /**
   * Whether {@link initialize} has finished one pass — flipped to true
   * after the API list call returns (or fails) so the snapshot's
   * `hydrated` flag can flip to true on the very next `updateSnapshot()`.
   */
  private isHydrated = false;

  /** Registered completion handlers by job type (survive React lifecycle) */
  private completionHandlers = new Map<string, (result: unknown, targetId: string) => Promise<void>>();

  /**
   * Register a completion handler for a job type.
   * These handlers persist across navigation and are called when jobs complete.
   * Use for persistence logic that must run even if React component is unmounted.
   */
  registerCompletionHandler(
    jobType: string,
    handler: (result: unknown, targetId: string) => Promise<void>
  ): void {
    this.completionHandlers.set(jobType, handler);
  }

  /**
   * Initialize by checking backend for any active jobs.
   * Call this on app startup to restore state after page refresh/navigation.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      let entries: { jobId: string; itemId: string; itemType: ActiveOperationItemType; startedAt: string; assistantMessageId?: string }[] = [];
      
      if (typeof window !== 'undefined') {
        try {
          const response = await fetch('/api/jobs');
          if (response.ok) {
            const data = await response.json();
            entries = (data.jobs || [])
              .filter((job: { status: string }) => job.status === 'pending' || job.status === 'running')
              .map((job: { id: string; targetId?: string; type: string; createdAt: string; assistantMessageId?: string }) => ({
                jobId: job.id,
                itemId: job.targetId || job.id,
                itemType: JOB_ITEM_TYPE_BY_TYPE[job.type as OperationType] || 'topic',
                startedAt: job.createdAt,
                assistantMessageId: job.assistantMessageId,
              }));
          }
        } catch (err) {
          log.warn('Failed to fetch active jobs from API:', err);
        }
      } else {
        const storeEntries = await activeOperationsStore.getEntries();
        entries = storeEntries;
      }

      if (entries.length > 0) {
        log.info(`Found ${entries.length} active jobs on init`);
      }

      for (const entry of entries) {
        const jobType = ITEM_TYPE_TO_JOB_TYPE[entry.itemType];
        const operationId = `${jobType}:${entry.itemId}`;

        if (this.operations.has(operationId)) continue;

        const operation: ActiveOperation = {
          id: operationId,
          status: 'in-progress',
          meta: {
            type: jobType,
            startedAt: entry.startedAt,
            targetId: entry.itemId,
            jobId: entry.jobId,
            assistantMessageId: entry.assistantMessageId,
          },
        };

        this.operations.set(operationId, operation);
        this.jobToOperation.set(entry.jobId, operationId);
        // Chat operations stream exclusively via SSE; per-job status polling
        // is intentionally skipped to avoid duplicating transport. The SSE
        // subscription hook discovers the jobId via `snapshot.chatMessages`
        // and clears the op on `[DONE]` via `completeExistingJob`.
        if (jobType !== 'chat-response') {
          this.startPolling(entry.jobId, operationId);
        }
      }

      // Flip the hydration flag regardless of whether we found any
      // entries — the snapshot now authoritatively reflects backend
      // state and downstream consumers (the chat hook) can safely
      // treat empty `chatMessages` as "no in-flight stream".
      this.isHydrated = true;
      this.updateSnapshot();
      this.notifyListeners();
    } catch (error) {
      log.warn('Failed to check for active jobs:', error);
      // Even on failure, flip hydrated so stale-stream cleanup is not
      // blocked indefinitely — the snapshot is no less accurate than
      // before initialize() ran.
      this.isHydrated = true;
      this.updateSnapshot();
      this.notifyListeners();
    }
  }

  /**
   * Start a background job via the backend job queue.
   * This is the preferred method for operations that must survive navigation.
   */
  async startBackgroundJob<T>(options: BackgroundJobOptions<T>): Promise<string | null> {
    const { type, targetId, input, clientTrigger, onComplete, onError } = options;

    try {
      const triggerMetadata = completeClientTriggerMetadata(clientTrigger, targetId);
      // Create job on the backend
      const response = await apiPost<JobResponse>('/api/jobs', {
        type,
        targetId,
        input,
      }, {
        clientTrigger: triggerMetadata,
      });

      if (!response?.id) {
        throw new Error('Failed to create background job');
      }

      const jobId = response.id;
      const operationId = `${type}:${targetId}`;

      log.info(`Created background job: ${jobId} for ${operationId}`);

      // Track mapping
      this.jobToOperation.set(jobId, operationId);

      // Create operation record for UI tracking
      const operation: ActiveOperation<T> = {
        id: operationId,
        status: 'in-progress',
        meta: {
          type: type as OperationType,
          startedAt: now(),
          targetId,
          jobId,
        },
      };

      this.operations.set(operationId, operation);
      this.updateSnapshot();
      this.notifyListeners();

      const itemType = JOB_ITEM_TYPE_BY_TYPE[type as OperationType];
      if (itemType) {
        activeOperationsStore.addEntry({
          itemId: targetId,
          itemType,
          jobId,
          startedAt: operation.meta.startedAt,
        }).catch((err) => {
          log.warn('Failed to persist active operation entry', { err, jobId, operationId });
        });
      }

      // Start polling for job completion
      this.startPolling(jobId, operationId, onComplete as ((result: unknown) => void | Promise<void>) | undefined, onError);

      return operationId;
    } catch (error) {
      log.error('Failed to start background job:', error);
      onError?.(error as Error);
      return null;
    }
  }

  /**
   * Poll for job completion.
   */
  private startPolling<T>(
    jobId: string,
    operationId: string,
    onComplete?: (result: T) => void | Promise<void>,
    onError?: (error: Error) => void
  ): void {
    const startTime = Date.now();

    const poll = async () => {
      try {
        const job = await apiGet<JobResponse>(`/api/jobs/${jobId}`);

        const decision = getJobPollingDecision({
          job,
          elapsedMs: Date.now() - startTime,
          timeoutMs: MAX_POLL_TIME_MS,
        });

        if (decision.kind === 'missing') {
          log.warn(`Job ${jobId} not found`);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', decision.error);
          onError?.(new Error(decision.error));
          return;
        }

        if (decision.kind === 'completed') {
          log.info(`Job ${jobId} completed`);
          this.stopPolling(jobId);

          // Update operation
          const operation = this.operations.get(operationId);
          if (operation) {
            operation.status = 'complete';
            operation.result = job.result;
            this.updateSnapshot();
            this.notifyListeners();
          }

          // ALWAYS run registered handler first (for persistence)
          // This ensures data is saved even if React component unmounted
          if (job.result && job.targetId) {
            const handler = this.completionHandlers.get(job.type);
            if (handler) {
              try {
                await handler(job.result, job.targetId);
                log.info(`Registered handler completed for ${job.type}`);
              } catch (err) {
                log.error(`Registered completion handler failed:`, err);
              }
            }
          }

          // ALSO call React callback if provided (for immediate UI update)
          // The component may have unmounted, but the callback might still work
          // If it fails, that's okay - the registered handler already persisted
          if (onComplete && job.result) {
            try {
              await onComplete(job.result as T);
            } catch (err) {
              log.error(`onComplete callback failed (component may have unmounted):`, err);
            }
          }

          // Cleanup after delay
          setTimeout(() => this.cleanup(operationId), 1000);
          return;
        }

        if (decision.kind === 'cancelled') {
          log.info(`Job ${jobId} was cancelled externally`);
          this.stopPolling(jobId);
          this.cleanup(operationId);
          return;
        }

        if (decision.kind === 'failed') {
          log.error(`Job ${jobId} failed:`, job.error);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', decision.error);
          onError?.(new Error(decision.error || 'Job failed'));
          setTimeout(() => this.cleanup(operationId), 5000);
          return;
        }

        if (decision.kind === 'timed-out') {
          log.warn(`Job ${jobId} polling timed out`);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', decision.error);
          onError?.(new Error(decision.error));
          setTimeout(() => this.cleanup(operationId), 5000);
          return;
        }

        // Still running, continue polling
        log.debug(`Job ${jobId} status: ${job.status}`);
      } catch (error) {
        log.error(`Error polling job ${jobId}:`, error);
        // Don't stop polling on transient errors
      }
    };

    // Initial poll
    poll();

    // Set up interval
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    this.pollingIntervals.set(jobId, interval);
  }

  /**
   * Stop polling for a job.
   */
  private stopPolling(jobId: string): void {
    const interval = this.pollingIntervals.get(jobId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(jobId);
    }
    this.jobToOperation.delete(jobId);
    void this.removeActiveEntry(jobId);
  }

  /**
   * Abort an operation (user clicked Stop).
   */
  abort(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (!operation) {
      return false;
    }

    if (operation.abortController) {
      operation.abortController.abort();
    }

    operation.status = 'aborted';
    this.updateSnapshot();
    this.notifyListeners();

    log.debug(`Aborted operation: ${operationId}`);

    // Clean up immediately
    setTimeout(() => this.cleanup(operationId), 100);

    return true;
  }

  /**
   * Check if an operation is currently active (in-progress).
   */
  isActive(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    return operation?.status === 'in-progress';
  }

  /**
   * Check if any operation of a given type is active.
   */
  hasActiveOfType(type: OperationType): boolean {
    for (const op of this.operations.values()) {
      if (op.meta.type === type && op.status === 'in-progress') {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active operation IDs for a given type.
   * Returns a cached Set for useSyncExternalStore stability.
   */
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

  /**
   * Get an operation by ID.
   */
  get(operationId: string): ActiveOperation | undefined {
    return this.operations.get(operationId);
  }

  /**
   * Get the current snapshot (for useSyncExternalStore).
   * Returns a cached reference that only changes when data changes.
   */
  getSnapshot(): OperationsSnapshot {
    return this.cachedSnapshot;
  }

  /**
   * Subscribe to operation changes.
   */
  subscribe(listener: OperationsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Update the cached snapshot when operations change.
   */
  private updateSnapshot(): void {
    const state = buildOperationState(this.operations, this.isHydrated);
    this.cachedSnapshot = state.snapshot;
    this.cachedActiveIds = state.activeIds;
  }

  /**
   * Update an operation's status.
   */
  private updateStatus(operationId: string, status: OperationStatus, error?: string): void {
    const operation = this.operations.get(operationId);
    if (operation) {
      operation.status = status;
      if (error) {
        operation.error = error;
      }
      this.updateSnapshot();
      this.notifyListeners();
    }
  }

  /**
   * Clean up a completed/failed/aborted operation.
   */
  private cleanup(operationId: string): void {
    if (this.operations.delete(operationId)) {
      this.updateSnapshot();
      this.notifyListeners();
      log.debug(`Cleaned up operation: ${operationId}`);
    }
  }

  /**
   * Notify all listeners of a change.
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    });
  }

  /**
   * Get active chat-response operations for a specific thread.
   * Returns the operation if there's an active background job for the thread.
   */
  getActiveChatJobForThread(threadId: string): ActiveOperation | undefined {
    for (const op of this.operations.values()) {
      if (op.meta.type === 'chat-response' && 
          op.meta.targetId === threadId && 
          op.status === 'in-progress') {
        return op;
      }
    }
    return undefined;
  }

  /**
   * Check if there's an active chat-response job for a thread.
   */
  hasActiveChatJob(threadId: string): boolean {
    return this.getActiveChatJobForThread(threadId) !== undefined;
  }

  /**
   * Cancel a background job by operation ID.
   * This stops polling and marks the job as aborted.
   */
  async cancelBackgroundJob(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId);
    if (!operation || operation.status !== 'in-progress') {
      log.debug(`Cancel request for ${operationId}: operation not found or not in-progress`);
      return false;
    }

    log.info(`Cancelling background job: ${operationId}`);

    // Find the jobId from operation metadata
    const jobId = operation.meta.jobId;
    if (jobId) {
      // Stop polling
      this.stopPolling(jobId);
      log.info(`[Job ${jobId}] Stopped client-side polling`);
      
      // Send cancel request to server (marks job as cancelled, destroys SDK session)
      try {
        log.info(`[Job ${jobId}] Sending cancellation request to server...`);
        const response = await apiDelete(`/api/jobs/${jobId}`);
        log.info(`[Job ${jobId}] Server cancellation response:`, response);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to cancel on server (may have completed):`, err);
      }
    }

    // Mark as aborted
    operation.status = 'aborted';
    this.updateSnapshot();
    this.notifyListeners();
    
    log.info(`Cancelled background job: ${operationId}`);
    
    // Clean up immediately
    setTimeout(() => this.cleanup(operationId), 100);
    
    return true;
  }

  private async removeActiveEntry(jobId: string): Promise<void> {
    try {
      await activeOperationsStore.removeByJobId(jobId);
    } catch (error) {
      log.warn('Failed to remove active operation entry', { error, jobId });
    }
  }

  /**
   * Cancel active chat job for a thread.
   */
  async cancelChatJobForThread(threadId: string): Promise<boolean> {
    const operation = this.getActiveChatJobForThread(threadId);
    if (!operation) {
      return false;
    }
    
    const operationId = `chat-response:${threadId}`;
    return this.cancelBackgroundJob(operationId);
  }

  /**
   * Register an externally-created background job so consumers using
   * the operations snapshot (e.g. the chat SSE subscription hook) can
   * see it. Used by code paths that create jobs via raw `apiPost`
   * rather than `startBackgroundJob`, where polling is undesirable
   * (chat streams over SSE rather than poll-on-completion).
   *
   * Idempotent: re-registering the same operationId is a no-op aside
   * from updating the jobId mapping.
   */
  registerExistingJob(
    jobId: string,
    type: OperationType,
    targetId: string,
    assistantMessageId?: string,
  ): void {
    const operationId = `${type}:${targetId}`;
    const existing = this.operations.get(operationId);
    if (existing) {
      // Refresh jobId metadata when a new job replaces an older one for
      // the same target (e.g. user sends a second message in the same
      // thread before the prior op was cleaned up). Without this the
      // SSE subscription hook would keep targeting the old job.
      if (existing.meta.jobId && existing.meta.jobId !== jobId) {
        this.jobToOperation.delete(existing.meta.jobId);
      }
      existing.meta = {
        ...existing.meta,
        jobId,
        startedAt: now(),
        // Preserve a previously-set assistantMessageId if the caller
        // doesn't supply one — losing it would later cause the SSE
        // subscriber to register an empty id in the chat-stream-store
        // and the UI would refuse to render the streaming bubble.
        assistantMessageId: assistantMessageId ?? existing.meta.assistantMessageId,
      };
      existing.status = 'in-progress';
    } else {
      const operation: ActiveOperation = {
        id: operationId,
        status: 'in-progress',
        meta: {
          type,
          startedAt: now(),
          targetId,
          jobId,
          assistantMessageId,
        },
      };
      this.operations.set(operationId, operation);
    }
    this.jobToOperation.set(jobId, operationId);

    const itemType = JOB_ITEM_TYPE_BY_TYPE[type];
    if (itemType) {
      activeOperationsStore.addEntry({
        itemId: targetId,
        itemType,
        jobId,
        startedAt: this.operations.get(operationId)?.meta.startedAt ?? now(),
        assistantMessageId: this.operations.get(operationId)?.meta.assistantMessageId,
      }).catch((err) => {
        log.warn('Failed to persist active operation entry', { err, jobId, operationId });
      });
    }

    this.updateSnapshot();
    this.notifyListeners();
  }

  /**
   * Tear down a registered chat operation when its SSE stream terminates
   * (done / failed / cancelled). Mirrors the polling-based completion
   * path's cleanup but for the no-polling SSE-only path:
   *  - removes the in-memory operation,
   *  - clears the jobId mapping,
   *  - evicts the persisted active-operations-store entry,
   *  - refreshes the snapshot.
   *
   * Safe to call with an unknown jobId (no-op).
   */
  completeExistingJob(jobId: string): void {
    const operationId = this.jobToOperation.get(jobId);
    if (operationId) {
      this.operations.delete(operationId);
      this.jobToOperation.delete(jobId);
      void this.removeActiveEntry(jobId);
      this.updateSnapshot();
      this.notifyListeners();
    } else {
      // Even if the in-memory op was never registered (e.g. job created
      // before page load and only discovered via initialize), drop the
      // persisted entry so the next initialize doesn't resurrect it.
      void this.removeActiveEntry(jobId);
    }
  }
}

/** Singleton instance */
export const operationsManager = new ActiveOperationsManager();
