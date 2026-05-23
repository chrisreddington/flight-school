/**
 * Background Jobs Storage
 *
 * File-based storage for background AI jobs using the storage utils.
 * Persists across API route invocations in dev mode.
 *
 * ## Concurrency model
 *
 * All mutating operations go through {@link withJobsMutation}, which holds a
 * process-local async mutex around the load → mutate → save sequence. This
 * eliminates intra-process lost-update races. Reads still hit disk on every
 * call (no module-level cache) so the worker process and the web process
 * always see the latest committed state without needing manual invalidation.
 *
 * Cross-process write races (both web and worker writing the same
 * `background-jobs` file) are NOT solved here — that requires the worker to
 * become the sole writer, which is the Phase 2B migration. See
 * `docs/streaming-architecture-plan.md` (session artifact).
 *
 * The {@link withJobsMutation} primitive enforces a no-re-entry invariant:
 * the callback receives the current schema and must return the new schema
 * synchronously. Calling another mutating `jobStorage.*` method from inside
 * the callback would deadlock and is treated as a programmer error.
 */

import { logger } from '@/lib/logger';
import type { TracePropagationHeaders } from '@/lib/observability/context-propagation';
import type { ClientTriggerMetadata } from '@/lib/observability/trigger-metadata';
import { readStorage, writeStorage, deleteStorage } from '@/lib/storage/utils';

const log = logger.withTag('JobStorage');

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Structured error codes for failed jobs.
 *
 * Surfaced to the polling client so the UI can route credentials-related
 * failures to a re-auth CTA instead of rendering a generic error string.
 */
export type JobErrorCode =
  | 'credentials_missing'
  | 'credentials_refresh_failed'
  | 'unknown';

interface JobCausalityContext extends TracePropagationHeaders {
  capturedAt: string;
  trigger?: ClientTriggerMetadata;
}

export interface BackgroundJob<T = unknown> {
  id: string;
  type: string;
  /**
   * Owner of this job. **REQUIRED** on every job since the multi-tenant
   * hardening — read/list/cancel endpoints filter by this. Populated at
   * `/api/jobs` POST from {@link requireUserContext}. Older job records
   * persisted before this field existed are treated as orphaned and are
   * never returned to any user.
   */
  userId: string;
  targetId?: string;
  status: JobStatus;
  causality?: JobCausalityContext;
  input: Record<string, unknown>;
  result?: T;
  error?: string;
  /** Machine-readable failure classification; set alongside `error`. */
  errorCode?: JobErrorCode;
  /**
   * Short, user-facing label describing what the executor is doing
   * right now (e.g. "Running tests…"). Updated incrementally during
   * long-running jobs so the client can narrate progress.
   */
  currentStep?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

// Storage schema for jobs file
interface JobsStorageSchema {
  jobs: Record<string, BackgroundJob>;
  version: number;
}

const STORAGE_KEY = 'background-jobs';
const DEFAULT_SCHEMA: JobsStorageSchema = { jobs: {}, version: 1 };

// Cleanup old jobs periodically (keep last 100, remove completed older than 1 hour)
const MAX_JOBS = 100;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Schema validator
function validateSchema(data: unknown): data is JobsStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.jobs !== 'object' || obj.jobs === null) return false;
  if (typeof obj.version !== 'number') return false;
  return true;
}

/**
 * Always reads from disk. Cache removed in Phase 1 of the streaming
 * architecture refactor — the cache was the root cause of the
 * cross-process stale-read bug that surfaced as "worker dispatch failed"
 * after the first job.
 */
async function loadJobs(): Promise<JobsStorageSchema> {
  try {
    return await readStorage<JobsStorageSchema>(STORAGE_KEY, DEFAULT_SCHEMA, validateSchema);
  } catch (err) {
    log.warn('Failed to load jobs from storage, using default:', err);
    return { jobs: {}, version: 1 };
  }
}

async function saveJobs(data: JobsStorageSchema): Promise<void> {
  try {
    await writeStorage(STORAGE_KEY, data);
  } catch (err) {
    log.error('Failed to save jobs to storage:', err);
    throw err;
  }
}

/**
 * Process-local async mutex protecting the load → mutate → save sequence.
 * All mutating ops chain through this single promise so concurrent calls in
 * the same process serialise rather than racing.
 */
let mutationChain: Promise<unknown> = Promise.resolve();
let inMutation = false;

/**
 * Atomically load → mutate → save the jobs schema under a process-local
 * mutex. The callback receives the current schema, mutates and returns it
 * (or returns a new schema object), plus an optional `result` value to
 * return to the caller.
 *
 * Nested calls (calling another mutating `jobStorage.*` method from inside
 * the callback) are rejected synchronously to surface deadlocks at the
 * source rather than hanging the process.
 */
async function withJobsMutation<TResult>(
  fn: (schema: JobsStorageSchema) => { schema: JobsStorageSchema; result: TResult } | Promise<{ schema: JobsStorageSchema; result: TResult }>,
): Promise<TResult> {
  const run = async (): Promise<TResult> => {
    if (inMutation) {
      throw new Error(
        'jobStorage: nested mutation detected. Mutating methods must not be called from inside withJobsMutation callbacks.',
      );
    }
    inMutation = true;
    try {
      const schema = await loadJobs();
      const { schema: nextSchema, result } = await fn(schema);
      await saveJobs(nextSchema);
      return result;
    } finally {
      inMutation = false;
    }
  };

  const next = mutationChain.then(run, run);
  // Keep the chain alive even on rejection so subsequent mutations still run.
  mutationChain = next.catch(() => undefined);
  return next;
}

function cleanup(schema: JobsStorageSchema): JobsStorageSchema {
  const now = Date.now();
  const toDelete: string[] = [];
  const jobs = schema.jobs;

  for (const [id, job] of Object.entries(jobs)) {
    // Remove old completed/failed/cancelled jobs
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      if (now - completedAt > MAX_AGE_MS) {
        toDelete.push(id);
      }
    }
  }

  // If still too many, remove oldest completed first
  const remainingCount = Object.keys(jobs).length - toDelete.length;
  if (remainingCount > MAX_JOBS) {
    const completed = Object.entries(jobs)
      .filter(([id, job]) =>
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        !toDelete.includes(id)
      )
      .sort((a, b) =>
        new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime()
      );

    const excess = remainingCount - MAX_JOBS;
    for (let i = 0; i < excess && i < completed.length; i++) {
      toDelete.push(completed[i][0]);
    }
  }

  if (toDelete.length === 0) {
    return schema;
  }

  const newJobs = { ...jobs };
  for (const id of toDelete) {
    delete newJobs[id];
  }

  log.debug(`Cleaned up ${toDelete.length} old jobs`);
  return { ...schema, jobs: newJobs };
}

/**
 * Internal mutation primitive — applies `mutate(job)` to the job with the
 * given id, persists the result, and returns the updated job. Returns
 * `undefined` if the job does not exist.
 *
 * All public mutating methods are thin wrappers over this.
 */
async function mutateJob<T>(
  id: string,
  mutate: (job: BackgroundJob<T>) => BackgroundJob<T>,
): Promise<BackgroundJob<T> | undefined> {
  return withJobsMutation<BackgroundJob<T> | undefined>((schema) => {
    const job = schema.jobs[id] as BackgroundJob<T> | undefined;
    if (!job) return { schema, result: undefined };
    const updated = mutate(job);
    schema.jobs[id] = updated as BackgroundJob;
    return { schema, result: updated };
  });
}

export const jobStorage = {
  /**
   * Create a new job.
   */
  async create<T>(job: Omit<BackgroundJob<T>, 'status' | 'createdAt'>): Promise<BackgroundJob<T>> {
    if (!job.userId) {
      throw new Error('jobStorage.create: userId is required (multi-tenant invariant)');
    }
    return withJobsMutation<BackgroundJob<T>>((schema) => {
      const cleaned = cleanup(schema);
      const newJob: BackgroundJob<T> = {
        ...job,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      cleaned.jobs[job.id] = newJob as BackgroundJob;
      log.info(`Created job: ${job.id} (${job.type})`);
      return { schema: cleaned, result: newJob };
    });
  },

  /**
   * Get a job by ID.
   */
  async get<T>(id: string): Promise<BackgroundJob<T> | undefined> {
    const schema = await loadJobs();
    return schema.jobs[id] as BackgroundJob<T> | undefined;
  },

  /**
   * Update a job's status.
   */
  async update<T>(id: string, updates: Partial<BackgroundJob<T>>): Promise<BackgroundJob<T> | undefined> {
    const updated = await mutateJob<T>(id, (job) => ({ ...job, ...updates } as BackgroundJob<T>));
    if (updated) log.debug(`Updated job ${id}: status=${updated.status}`);
    return updated;
  },

  /**
   * Mark a job as running.
   */
  async markRunning(id: string): Promise<BackgroundJob | undefined> {
    return mutateJob(id, (job) => ({
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
    }));
  },

  /**
   * Mark a job as completed with result.
   */
  async markCompleted<T>(id: string, result: T): Promise<BackgroundJob<T> | undefined> {
    return mutateJob<T>(id, (job) => ({
      ...job,
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    }));
  },

  /**
   * Mark a job as failed with error.
   *
   * Optionally accepts a structured `errorCode` so polling clients can
   * distinguish credentials-expired failures from generic errors.
   */
  async markFailed(
    id: string,
    error: string,
    errorCode?: JobErrorCode,
  ): Promise<BackgroundJob | undefined> {
    return mutateJob(id, (job) => ({
      ...job,
      status: 'failed',
      error,
      errorCode,
      completedAt: new Date().toISOString(),
    }));
  },

  /**
   * Update the human-readable `currentStep` label for an in-flight job.
   *
   * Safe to call repeatedly; only persists when the value actually
   * changes to avoid disk churn during high-frequency narration.
   */
  async setCurrentStep(id: string, step: string): Promise<BackgroundJob | undefined> {
    return mutateJob(id, (job) => {
      if (job.currentStep === step) return job;
      return { ...job, currentStep: step };
    });
  },

  /**
   * Mark a job as cancelled.
   */
  async markCancelled(id: string): Promise<BackgroundJob | undefined> {
    log.info(`Marking job ${id} as cancelled`);
    return mutateJob(id, (job) => ({
      ...job,
      status: 'cancelled',
      error: 'Cancelled by user',
      completedAt: new Date().toISOString(),
    }));
  },

  /**
   * Get all jobs of a specific type.
   */
  async getByType(type: string): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).filter(job => job.type === type);
  },

  /**
   * Get all pending/running jobs.
   */
  async getActive(): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).filter(
      job => job.status === 'pending' || job.status === 'running'
    );
  },

  /**
   * Find the active chat-response job for a thread.
   */
  async getActiveChatJobForThread(threadId: string): Promise<BackgroundJob | undefined> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).find(
      job =>
        job.type === 'chat-response' &&
        job.targetId === threadId &&
        (job.status === 'pending' || job.status === 'running')
    );
  },

  /**
   * Get all jobs (for debugging).
   */
  async getAll(): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs);
  },

  /**
   * Delete a job.
   */
  async delete(id: string): Promise<boolean> {
    return withJobsMutation<boolean>((schema) => {
      if (!schema.jobs[id]) return { schema, result: false };
      delete schema.jobs[id];
      return { schema, result: true };
    });
  },

  /**
   * Delete every job owned by the given user. Returns the number of
   * jobs removed. Used by the per-user "delete all my data" endpoint.
   * Does NOT cancel running jobs — callers should call `cancelRunningJob`
   * for any jobs that may still be executing in-process.
   */
  async deleteForUser(userId: string): Promise<{ deleted: number; ids: string[] }> {
    if (!userId) {
      throw new Error('jobStorage.deleteForUser: userId is required');
    }
    return withJobsMutation<{ deleted: number; ids: string[] }>((schema) => {
      const ids: string[] = [];
      const remaining: Record<string, BackgroundJob> = {};
      for (const [id, job] of Object.entries(schema.jobs)) {
        if (job.userId === userId) {
          ids.push(id);
        } else {
          remaining[id] = job;
        }
      }
      if (ids.length === 0) return { schema, result: { deleted: 0, ids: [] } };
      log.info(`Deleted ${ids.length} jobs for user ${userId}`);
      return { schema: { ...schema, jobs: remaining }, result: { deleted: ids.length, ids } };
    });
  },

  /**
   * Clear all jobs (for testing).
   */
  async clear(): Promise<void> {
    // Drain any pending mutations before deleting the file so we don't race
    // with an in-flight write.
    await mutationChain.catch(() => undefined);
    await deleteStorage(STORAGE_KEY);
  },

  /**
   * @deprecated The module-level cache was removed in the Phase 1 storage
   * refactor; reads always hit disk now. This method is a no-op kept for
   * call-site compatibility and will be removed once all defensive
   * `invalidateCache()` calls have been cleaned up.
   */
  invalidateCache(): void {
    // intentionally empty
  },
};
