/**
 * Background Jobs Storage
 * 
 * In-memory storage for background AI jobs. For production scale,
 * this could be replaced with Redis or a database.
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('JobStorage');

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BackgroundJob<T = unknown> {
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

// In-memory storage (survives across API calls within same server process)
const jobs = new Map<string, BackgroundJob>();

// Cleanup old jobs periodically (keep last 100, remove completed older than 1 hour)
const MAX_JOBS = 100;
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function cleanup(): void {
  const now = Date.now();
  const toDelete: string[] = [];
  
  for (const [id, job] of jobs) {
    // Remove old completed/failed jobs
    if (job.status === 'completed' || job.status === 'failed') {
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      if (now - completedAt > MAX_AGE_MS) {
        toDelete.push(id);
      }
    }
  }
  
  // If still too many, remove oldest completed first
  if (jobs.size - toDelete.length > MAX_JOBS) {
    const completed = Array.from(jobs.entries())
      .filter(([id, job]) => 
        (job.status === 'completed' || job.status === 'failed') && 
        !toDelete.includes(id)
      )
      .sort((a, b) => 
        new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime()
      );
    
    const excess = jobs.size - toDelete.length - MAX_JOBS;
    for (let i = 0; i < excess && i < completed.length; i++) {
      toDelete.push(completed[i][0]);
    }
  }
  
  for (const id of toDelete) {
    jobs.delete(id);
  }
  
  if (toDelete.length > 0) {
    log.debug(`Cleaned up ${toDelete.length} old jobs`);
  }
}

export const jobStorage = {
  /**
   * Create a new job.
   */
  create<T>(job: Omit<BackgroundJob<T>, 'status' | 'createdAt'>): BackgroundJob<T> {
    cleanup();
    
    const newJob: BackgroundJob<T> = {
      ...job,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    
    jobs.set(job.id, newJob as BackgroundJob);
    log.info(`Created job: ${job.id} (${job.type})`);
    
    return newJob;
  },
  
  /**
   * Get a job by ID.
   */
  get<T>(id: string): BackgroundJob<T> | undefined {
    return jobs.get(id) as BackgroundJob<T> | undefined;
  },
  
  /**
   * Update a job's status.
   */
  update<T>(id: string, updates: Partial<BackgroundJob<T>>): BackgroundJob<T> | undefined {
    const job = jobs.get(id);
    if (!job) return undefined;
    
    const updated = { ...job, ...updates } as BackgroundJob<T>;
    jobs.set(id, updated as BackgroundJob);
    
    log.debug(`Updated job ${id}: status=${updated.status}`);
    return updated;
  },
  
  /**
   * Mark a job as running.
   */
  markRunning(id: string): BackgroundJob | undefined {
    return this.update(id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Mark a job as completed with result.
   */
  markCompleted<T>(id: string, result: T): BackgroundJob<T> | undefined {
    return this.update<T>(id, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Mark a job as failed with error.
   */
  markFailed(id: string, error: string): BackgroundJob | undefined {
    return this.update(id, {
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
    });
  },
  
  /**
   * Get all jobs of a specific type.
   */
  getByType(type: string): BackgroundJob[] {
    return Array.from(jobs.values()).filter(job => job.type === type);
  },
  
  /**
   * Get all pending/running jobs.
   */
  getActive(): BackgroundJob[] {
    return Array.from(jobs.values()).filter(
      job => job.status === 'pending' || job.status === 'running'
    );
  },
  
  /**
   * Get all jobs (for debugging).
   */
  getAll(): BackgroundJob[] {
    return Array.from(jobs.values());
  },
  
  /**
   * Delete a job.
   */
  delete(id: string): boolean {
    return jobs.delete(id);
  },
  
  /**
   * Clear all jobs (for testing).
   */
  clear(): void {
    jobs.clear();
  },
};
