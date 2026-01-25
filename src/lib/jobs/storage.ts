/**
 * Background Jobs Storage
 * 
 * File-based storage for background AI jobs using the storage utils.
 * This ensures jobs persist across API route invocations in dev mode.
 */

import { logger } from '@/lib/logger';
import { readStorage, writeStorage, deleteStorage } from '@/lib/storage/utils';

const log = logger.withTag('JobStorage');

type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface BackgroundJob<T = unknown> {
  id: string;
  type: string;
  targetId?: string;
  status: JobStatus;
  input: Record<string, unknown>;
  result?: T;
  error?: string;
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

// Read jobs from storage (synchronously cached in memory for performance)
let jobsCache: JobsStorageSchema | null = null;

async function loadJobs(): Promise<JobsStorageSchema> {
  if (jobsCache !== null) {
    return jobsCache;
  }
  
  try {
    const data = await readStorage<JobsStorageSchema>(STORAGE_KEY, DEFAULT_SCHEMA, validateSchema);
    jobsCache = data;
    return data;
  } catch (err) {
    log.warn('Failed to load jobs from storage, using default:', err);
    jobsCache = DEFAULT_SCHEMA;
    return DEFAULT_SCHEMA;
  }
}

async function saveJobs(data: JobsStorageSchema): Promise<void> {
  jobsCache = data;
  try {
    await writeStorage(STORAGE_KEY, data);
  } catch (err) {
    log.error('Failed to save jobs to storage:', err);
    throw err;
  }
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

export const jobStorage = {
  /**
   * Create a new job.
   */
  async create<T>(job: Omit<BackgroundJob<T>, 'status' | 'createdAt'>): Promise<BackgroundJob<T>> {
    const schema = await loadJobs();
    const cleaned = cleanup(schema);
    
    const newJob: BackgroundJob<T> = {
      ...job,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    
    cleaned.jobs[job.id] = newJob as BackgroundJob;
    await saveJobs(cleaned);
    log.info(`Created job: ${job.id} (${job.type})`);
    
    return newJob;
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
    const schema = await loadJobs();
    const job = schema.jobs[id];
    if (!job) return undefined;
    
    const updated = { ...job, ...updates } as BackgroundJob<T>;
    schema.jobs[id] = updated as BackgroundJob;
    await saveJobs(schema);
    
    log.debug(`Updated job ${id}: status=${updated.status}`);
    return updated;
  },
  
  /**
   * Mark a job as running.
   */
  async markRunning(id: string): Promise<BackgroundJob | undefined> {
    return this.update(id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Mark a job as completed with result.
   */
  async markCompleted<T>(id: string, result: T): Promise<BackgroundJob<T> | undefined> {
    return this.update<T>(id, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Mark a job as failed with error.
   */
  async markFailed(id: string, error: string): Promise<BackgroundJob | undefined> {
    return this.update(id, {
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Mark a job as cancelled.
   */
  async markCancelled(id: string): Promise<BackgroundJob | undefined> {
    log.info(`Marking job ${id} as cancelled`);
    return this.update(id, {
      status: 'cancelled',
      error: 'Cancelled by user',
      completedAt: new Date().toISOString(),
    });
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
    const schema = await loadJobs();
    if (!schema.jobs[id]) return false;
    
    delete schema.jobs[id];
    await saveJobs(schema);
    return true;
  },
  
  /**
   * Clear all jobs (for testing).
   */
  async clear(): Promise<void> {
    jobsCache = DEFAULT_SCHEMA;
    await deleteStorage(STORAGE_KEY);
  },
  
  /**
   * Invalidate cache (force reload from disk).
   */
  invalidateCache(): void {
    jobsCache = null;
  },
};
