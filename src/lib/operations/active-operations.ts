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
 *
 * @example
 * ```typescript
 * import { operationsManager } from '@/lib/operations';
 *
 * // Start an operation that survives navigation
 * operationsManager.startBackgroundJob({
 *   type: 'topic-regeneration',
 *   targetId: 'topic-123',
 *   input: { existingTopicTitles: ['Topic A'] },
 *   onComplete: async (result) => {
 *     await focusStore.saveTodaysFocus(result);
 *   },
 * });
 *
 * // Check if operation is active
 * if (operationsManager.isActiveForTarget('topic-123')) {
 *   // Show skeleton
 * }
 * ```
 */

import { apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type {
  ActiveOperation,
  OperationsListener,
  OperationsSnapshot,
  OperationStatus,
  OperationType,
  StartOperationOptions,
} from './types';

const log = logger.withTag('OperationsManager');

/** Polling interval for job status (ms) */
const POLL_INTERVAL_MS = 1000;

/** Maximum time to poll before giving up (ms) */
const MAX_POLL_TIME_MS = 120000;

interface BackgroundJobOptions<T> {
  type: 'topic-regeneration';
  targetId: string;
  input: Record<string, unknown>;
  onComplete?: (result: T) => void | Promise<void>;
  onError?: (error: Error) => void;
}

interface JobResponse {
  id: string;
  type: string;
  targetId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

interface JobsListResponse {
  jobs: JobResponse[];
}

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
      // Fetch all active (pending/running) jobs from backend
      const response = await apiGet<JobsListResponse>('/api/jobs?status=pending');
      const pendingJobs = response?.jobs || [];
      
      const runningResponse = await apiGet<JobsListResponse>('/api/jobs?status=running');
      const runningJobs = runningResponse?.jobs || [];
      
      const activeJobs = [...pendingJobs, ...runningJobs];

      if (activeJobs.length > 0) {
        log.info(`Found ${activeJobs.length} active jobs on init`);
      }

      // Restore tracking for each active job
      for (const job of activeJobs) {
        const operationId = `${job.type}:${job.targetId || job.id}`;
        
        // Skip if already tracking
        if (this.operations.has(operationId)) continue;

        // Create operation record
        const operation: ActiveOperation = {
          id: operationId,
          status: 'in-progress',
          meta: {
            type: job.type as OperationType,
            startedAt: new Date().toISOString(),
            targetId: job.targetId,
            jobId: job.id,
          },
        };

        this.operations.set(operationId, operation);
        this.jobToOperation.set(job.id, operationId);

        // Start polling for this job (no callbacks - just update state)
        this.startPolling(job.id, operationId);
      }

      if (activeJobs.length > 0) {
        this.updateSnapshot();
        this.notifyListeners();
      }
    } catch (error) {
      log.warn('Failed to check for active jobs:', error);
    }
  }

  /**
   * Start a background job via the backend job queue.
   * This is the preferred method for operations that must survive navigation.
   */
  async startBackgroundJob<T>(options: BackgroundJobOptions<T>): Promise<string | null> {
    const { type, targetId, input, onComplete, onError } = options;

    try {
      // Create job on the backend
      const response = await apiPost<JobResponse>('/api/jobs', {
        type,
        targetId,
        input,
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
          startedAt: new Date().toISOString(),
          targetId,
          jobId,
        },
      };

      this.operations.set(operationId, operation);
      this.updateSnapshot();
      this.notifyListeners();

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

        if (!job) {
          log.warn(`Job ${jobId} not found`);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', 'Job not found');
          onError?.(new Error('Job not found'));
          return;
        }

        if (job.status === 'completed') {
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

          // Call React callback if provided
          if (onComplete && job.result) {
            try {
              await onComplete(job.result as T);
            } catch (err) {
              log.error(`onComplete callback failed:`, err);
            }
          } else if (job.result && job.targetId) {
            // No React callback - use registered handler (for post-navigation completion)
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

          // Cleanup after delay
          setTimeout(() => this.cleanup(operationId), 1000);
          return;
        }

        if (job.status === 'failed') {
          log.error(`Job ${jobId} failed:`, job.error);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', job.error);
          onError?.(new Error(job.error || 'Job failed'));
          setTimeout(() => this.cleanup(operationId), 5000);
          return;
        }

        // Check for timeout
        if (Date.now() - startTime > MAX_POLL_TIME_MS) {
          log.warn(`Job ${jobId} polling timed out`);
          this.stopPolling(jobId);
          this.updateStatus(operationId, 'failed', 'Operation timed out');
          onError?.(new Error('Operation timed out'));
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
  }

  /**
   * Start a new operation (legacy method for non-background operations).
   * For operations that must survive navigation, use startBackgroundJob instead.
   */
  start<T>(options: StartOperationOptions<T>): string {
    const { id, type, description, targetId, executor, onComplete, onError, context } = options;

    // Generate operation ID
    const operationId = id || `${type}:${targetId || crypto.randomUUID()}`;

    // Check if operation already exists
    if (this.operations.has(operationId)) {
      log.warn(`Operation ${operationId} already exists, aborting previous`);
      this.abort(operationId);
    }

    // Create abort controller for this operation
    const abortController = new AbortController();

    // Create the operation record
    const operation: ActiveOperation<T> = {
      id: operationId,
      status: 'in-progress',
      meta: {
        type,
        startedAt: new Date().toISOString(),
        description,
        targetId,
        context,
      },
      abortController,
    };

    // Register the operation
    this.operations.set(operationId, operation);
    this.updateSnapshot();
    this.notifyListeners();

    log.debug(`Started operation: ${operationId}`, { type, targetId });

    // Execute the operation in background (not awaited!)
    this.executeOperation(operationId, executor, abortController.signal, onComplete, onError);

    return operationId;
  }

  /**
   * Execute the operation and handle completion/failure.
   * This runs independently of the calling code.
   */
  private async executeOperation<T>(
    operationId: string,
    executor: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
    onComplete?: (result: T) => void | Promise<void>,
    onError?: (error: Error) => void
  ): Promise<void> {
    try {
      // Execute the actual work
      const result = await executor(signal);

      // Check if aborted during execution
      if (signal.aborted) {
        log.debug(`Operation ${operationId} was aborted during execution`);
        return;
      }

      // Update operation status
      const operation = this.operations.get(operationId);
      if (operation) {
        operation.status = 'complete';
        operation.result = result;
        this.updateSnapshot();
        this.notifyListeners();
      }

      log.debug(`Operation ${operationId} completed successfully`);

      // Call completion callback (this handles persistence)
      if (onComplete) {
        try {
          await onComplete(result);
        } catch (err) {
          log.error(`onComplete callback failed for ${operationId}:`, err);
        }
      }

      // Clean up after a short delay to allow UI to react
      setTimeout(() => this.cleanup(operationId), 1000);
    } catch (error) {
      // Check if this was an abort
      if ((error as Error).name === 'AbortError') {
        log.debug(`Operation ${operationId} aborted`);
        this.updateStatus(operationId, 'aborted');
        return;
      }

      // Handle failure
      log.error(`Operation ${operationId} failed:`, error);
      this.updateStatus(operationId, 'failed', (error as Error).message);

      if (onError) {
        onError(error as Error);
      }

      // Clean up failed operations after delay
      setTimeout(() => this.cleanup(operationId), 5000);
    }
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
      case 'chat-message':
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
    const topicRegenerations = new Map<string, ActiveOperation>();
    const challengeRegenerations = new Map<string, ActiveOperation>();
    const goalRegenerations = new Map<string, ActiveOperation>();
    const chatMessages = new Map<string, ActiveOperation>();

    // Also build active ID sets
    const activeTopicIds = new Set<string>();
    const activeChallengeIds = new Set<string>();
    const activeGoalIds = new Set<string>();
    const activeChatIds = new Set<string>();

    for (const [id, op] of this.operations) {
      const isActive = op.status === 'in-progress';
      const targetId = op.meta.targetId || id;

      switch (op.meta.type) {
        case 'topic-regeneration':
          topicRegenerations.set(id, op);
          if (isActive) activeTopicIds.add(targetId);
          break;
        case 'challenge-regeneration':
          challengeRegenerations.set(id, op);
          if (isActive) activeChallengeIds.add(targetId);
          break;
        case 'goal-regeneration':
          goalRegenerations.set(id, op);
          if (isActive) activeGoalIds.add(targetId);
          break;
        case 'chat-message':
          chatMessages.set(id, op);
          if (isActive) activeChatIds.add(id);
          break;
      }
    }

    this.cachedSnapshot = {
      topicRegenerations,
      challengeRegenerations,
      goalRegenerations,
      chatMessages,
    };

    // Update cached active ID sets
    this.cachedActiveIds = {
      topics: activeTopicIds,
      challenges: activeChallengeIds,
      goals: activeGoalIds,
      chat: activeChatIds,
    };
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
}

/** Singleton instance */
export const operationsManager = new ActiveOperationsManager();
