/**
 * Background Jobs Storage
 *
 * File-based storage for background AI jobs persisted via the storage utils.
 *
 * @remarks
 * **Concurrency model.** All mutating operations route through
 * {@link withJobsMutation}, which holds a process-local async mutex around
 * the load → mutate → save sequence. Reads always hit disk (no module-level
 * cache) so the worker process and web process see the latest committed
 * state without manual invalidation.
 *
 * Cross-process write races (web + worker writing the same `background-jobs`
 * file) are NOT solved here — that requires the worker to become the sole
 * writer.
 */

import { deleteStorage } from '@/lib/storage/utils';

import {
  type BackgroundJob,
  type JobErrorCode,
  type JobStatus,
  STORAGE_KEY,
  cleanup,
  drainMutations,
  jobLog as log,
  loadJobs,
  mutateJob,
  withJobsMutation,
} from './storage-internals';

export type { BackgroundJob, JobErrorCode, JobStatus };

export const jobStorage = {
  /** Create a new job. */
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
   * Atomic check-then-create. Closes the read-then-write race that existed
   * when callers used `get(id)` + `create(...)` separately.
   *
   * `findCollision` runs INSIDE the mutation with the freshly-loaded schema,
   * so callers can enforce tuple uniqueness (e.g. the chat-response
   * `(userId, threadId, assistantMessageId)` dedupe) under the same lock
   * that holds the insert.
   */
  async createIfAbsent<T>(
    job: Omit<BackgroundJob<T>, 'status' | 'createdAt'>,
    findCollision?: (schema: Readonly<Record<string, BackgroundJob>>) => BackgroundJob | undefined,
  ): Promise<{ created: true; job: BackgroundJob<T> } | { created: false; existing: BackgroundJob<T> }> {
    if (!job.userId) {
      throw new Error('jobStorage.createIfAbsent: userId is required (multi-tenant invariant)');
    }
    return withJobsMutation<{ created: true; job: BackgroundJob<T> } | { created: false; existing: BackgroundJob<T> }>(
      (schema) => {
        const cleaned = cleanup(schema);
        const byId = cleaned.jobs[job.id];
        if (byId) {
          return { schema: cleaned, result: { created: false, existing: byId as BackgroundJob<T> } };
        }
        const collision = findCollision ? findCollision(cleaned.jobs) : undefined;
        if (collision) {
          return {
            schema: cleaned,
            result: { created: false, existing: collision as BackgroundJob<T> },
          };
        }
        const newJob: BackgroundJob<T> = {
          ...job,
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        cleaned.jobs[job.id] = newJob as BackgroundJob;
        log.info(`Created job (if-absent): ${job.id} (${job.type})`);
        return { schema: cleaned, result: { created: true, job: newJob } };
      },
    );
  },

  /** Get a job by ID. */
  async get<T>(id: string): Promise<BackgroundJob<T> | undefined> {
    const schema = await loadJobs();
    return schema.jobs[id] as BackgroundJob<T> | undefined;
  },

  /** Update a job's fields. */
  async update<T>(id: string, updates: Partial<BackgroundJob<T>>): Promise<BackgroundJob<T> | undefined> {
    const updated = await mutateJob<T>(id, (job) => ({ ...job, ...updates }) as BackgroundJob<T>);
    if (updated) log.debug(`Updated job ${id}: status=${updated.status}`);
    return updated;
  },

  /** Mark a job as running. */
  async markRunning(id: string): Promise<BackgroundJob | undefined> {
    return mutateJob(id, (job) => ({
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
    }));
  },

  /** Mark a job as completed with a result. */
  async markCompleted<T>(id: string, result: T): Promise<BackgroundJob<T> | undefined> {
    return mutateJob<T>(id, (job) => ({
      ...job,
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    }));
  },

  /**
   * Mark a job as failed. Optionally accepts a structured `errorCode` so
   * polling clients can distinguish credentials-expired failures from
   * generic errors.
   */
  async markFailed(id: string, error: string, errorCode?: JobErrorCode): Promise<BackgroundJob | undefined> {
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
   * Only persists when the value actually changes to avoid disk churn.
   */
  async setCurrentStep(id: string, step: string): Promise<BackgroundJob | undefined> {
    return mutateJob(id, (job) => {
      if (job.currentStep === step) return job;
      return { ...job, currentStep: step };
    });
  },

  /** Mark a job as cancelled. */
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
   * Idempotent completion mark with retry on transient I/O. If the job is
   * already terminal, this is a no-op and returns that status. Transient
   * failures are retried up to 3× with exponential backoff (100/200/400 ms).
   */
  async markCompletedIdempotent<T>(id: string, result: T): Promise<JobStatus> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await withJobsMutation<JobStatus>((schema) => {
          const job = schema.jobs[id];
          if (!job) return { schema, result: 'completed' as JobStatus };
          if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
            return { schema, result: job.status };
          }
          const next: BackgroundJob = {
            ...job,
            status: 'completed',
            result: result as unknown,
            completedAt: new Date().toISOString(),
          };
          schema.jobs[id] = next;
          return { schema, result: 'completed' as JobStatus };
        });
      } catch (err) {
        lastErr = err;
        const delayMs = 100 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    log.error(`markCompletedIdempotent failed for ${id} after 3 retries`, lastErr);
    throw lastErr instanceof Error ? lastErr : new Error('markCompletedIdempotent failed');
  },

  /**
   * Atomic CAS: transition to `failed` only if the job is currently pending
   * or running. Returns `{ status, transitioned }` so the worker can detect
   * a concurrent DELETE-initiated cancellation and preserve user intent.
   */
  async markFailedIfNonTerminal(
    id: string,
    message: string,
    errorCode?: JobErrorCode,
  ): Promise<{ status: JobStatus; transitioned: boolean }> {
    return withJobsMutation<{ status: JobStatus; transitioned: boolean }>((schema) => {
      const job = schema.jobs[id];
      if (!job) return { schema, result: { status: 'failed', transitioned: false } };
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return { schema, result: { status: job.status, transitioned: false } };
      }
      schema.jobs[id] = {
        ...job,
        status: 'failed',
        error: message,
        errorCode,
        completedAt: new Date().toISOString(),
      };
      return { schema, result: { status: 'failed', transitioned: true } };
    });
  },

  /**
   * Atomic CAS: transition to `cancelled` only if the job is currently
   * pending or running. Returns `{ status, transitioned }` so the caller
   * can tell whether the cancellation actually moved state forward.
   */
  async markCancelledIfNonTerminal(id: string): Promise<{ status: JobStatus; transitioned: boolean }> {
    return withJobsMutation<{ status: JobStatus; transitioned: boolean }>((schema) => {
      const job = schema.jobs[id];
      if (!job) return { schema, result: { status: 'cancelled', transitioned: false } };
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        return { schema, result: { status: job.status, transitioned: false } };
      }
      schema.jobs[id] = {
        ...job,
        status: 'cancelled',
        error: 'Cancelled by user',
        completedAt: new Date().toISOString(),
      };
      return { schema, result: { status: 'cancelled', transitioned: true } };
    });
  },

  /** Get all jobs of a specific type. */
  async getByType(type: string): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).filter((job) => job.type === type);
  },

  /** Get all pending/running jobs. */
  async getActive(): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).filter((job) => job.status === 'pending' || job.status === 'running');
  },

  /** Find the active chat-response job for a thread. */
  async getActiveChatJobForThread(threadId: string): Promise<BackgroundJob | undefined> {
    const schema = await loadJobs();
    return Object.values(schema.jobs).find(
      (job) =>
        job.type === 'chat-response' &&
        job.targetId === threadId &&
        (job.status === 'pending' || job.status === 'running'),
    );
  },

  /** Get all jobs (debugging). */
  async getAll(): Promise<BackgroundJob[]> {
    const schema = await loadJobs();
    return Object.values(schema.jobs);
  },

  /** Delete a job by id. */
  async delete(id: string): Promise<boolean> {
    return withJobsMutation<boolean>((schema) => {
      if (!schema.jobs[id]) return { schema, result: false };
      delete schema.jobs[id];
      return { schema, result: true };
    });
  },

  /**
   * Delete every job owned by `userId`. Returns the removed ids. Used by the
   * per-user "delete all my data" endpoint. Does NOT cancel running jobs.
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

  /** Clear all jobs (testing). Drains pending mutations first. */
  async clear(): Promise<void> {
    await drainMutations();
    await deleteStorage(STORAGE_KEY);
  },

  /**
   * @deprecated Reads always hit disk; there is no in-memory cache to
   * invalidate. Kept as a no-op for call-site compatibility until
   * defensive `invalidateCache()` calls are cleaned up.
   */
  invalidateCache(): void {
    // intentionally empty
  },
};
