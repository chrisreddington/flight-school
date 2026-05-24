/**
 * Internal primitives backing {@link jobStorage}: types, schema validation,
 * disk I/O, the process-local mutation mutex, and the cleanup routine.
 *
 * @remarks
 * Kept separate so the public `storage.ts` stays focused on the
 * caller-facing API and so the mutex + cleanup logic can be exercised
 * without piercing the `jobStorage` wrapper.
 */

import { logger } from '@/lib/logger';
import type { TracePropagationHeaders } from '@/lib/observability/context-propagation';
import type { ClientTriggerMetadata } from '@/lib/observability/trigger-metadata';
import { readStorage, writeStorage } from '@/lib/storage/utils';

const log = logger.withTag('JobStorage');

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Structured error codes for failed jobs. Surfaced to the polling client so
 * the UI can route credentials-related failures to a re-auth CTA instead of
 * rendering a generic error string.
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
   * Owner of this job. **REQUIRED** since the multi-tenant hardening —
   * read/list/cancel endpoints filter by this. Older records persisted
   * before this field existed are treated as orphaned and never returned.
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
   * Short, user-facing label describing what the executor is doing right now
   * (e.g. "Running tests…"). Updated incrementally during long-running jobs.
   */
  currentStep?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface JobsStorageSchema {
  jobs: Record<string, BackgroundJob>;
  version: number;
}

export const STORAGE_KEY = 'background-jobs';
const DEFAULT_SCHEMA: JobsStorageSchema = { jobs: {}, version: 1 };

// Cleanup tuning: keep last 100 jobs; remove completed older than 1 hour.
const MAX_JOBS = 100;
const MAX_AGE_MS = 60 * 60 * 1000;

function validateSchema(data: unknown): data is JobsStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.jobs !== 'object' || obj.jobs === null) return false;
  if (typeof obj.version !== 'number') return false;
  return true;
}

/**
 * Always reads from disk. The module-level cache was removed in Phase 1 of
 * the streaming architecture refactor — it caused cross-process stale reads
 * that surfaced as "worker dispatch failed" after the first job.
 */
export async function loadJobs(): Promise<JobsStorageSchema> {
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
 * Process-local async mutex protecting load → mutate → save. All mutating
 * ops chain through this single promise so concurrent calls in the same
 * process serialise instead of racing.
 */
let mutationChain: Promise<unknown> = Promise.resolve();
let inMutation = false;

/** Drains pending mutations — used by `clear()` to avoid racing with a write. */
export function drainMutations(): Promise<unknown> {
  return mutationChain.catch(() => undefined);
}

/**
 * Atomically load → mutate → save the jobs schema under the process-local
 * mutex. Nested calls are rejected synchronously to surface deadlocks at the
 * source rather than hanging the process.
 */
export async function withJobsMutation<TResult>(
  fn: (
    schema: JobsStorageSchema,
  ) => { schema: JobsStorageSchema; result: TResult } | Promise<{ schema: JobsStorageSchema; result: TResult }>,
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

/** Trims old terminal jobs + caps the total. Pure; returns a new schema. */
export function cleanup(schema: JobsStorageSchema): JobsStorageSchema {
  const now = Date.now();
  const toDelete: string[] = [];
  const jobs = schema.jobs;

  for (const [id, job] of Object.entries(jobs)) {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      if (now - completedAt > MAX_AGE_MS) {
        toDelete.push(id);
      }
    }
  }

  const remainingCount = Object.keys(jobs).length - toDelete.length;
  if (remainingCount > MAX_JOBS) {
    const completed = Object.entries(jobs)
      .filter(
        ([id, job]) =>
          (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
          !toDelete.includes(id),
      )
      .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime());

    const excess = remainingCount - MAX_JOBS;
    for (let i = 0; i < excess && i < completed.length; i++) {
      toDelete.push(completed[i][0]);
    }
  }

  if (toDelete.length === 0) return schema;

  const newJobs = { ...jobs };
  for (const id of toDelete) delete newJobs[id];
  log.debug(`Cleaned up ${toDelete.length} old jobs`);
  return { ...schema, jobs: newJobs };
}

/**
 * Apply `mutate(job)` to the job with the given id; persist and return the
 * updated job, or `undefined` if the job does not exist. All public mutating
 * methods are thin wrappers over this.
 */
export async function mutateJob<T>(
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

export { log as jobLog };
