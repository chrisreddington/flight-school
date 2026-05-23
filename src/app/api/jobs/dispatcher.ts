import type {
  DispatchJobExecutionRequest,
  DispatchJobExecutionToWorkerRequest,
  DispatchableJobInput,
  DispatchableJobType,
} from '@/lib/jobs/dispatch';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';

import { dispatchJobExecutionToWorker } from './worker-client';

const log = logger.withTag('JobDispatcher');

export type { DispatchJobExecutionRequest, DispatchableJobInput, DispatchableJobType };

/**
 * Schedule worker dispatch asynchronously to preserve the existing
 * fire-and-forget route behavior.
 */
export function dispatchJobExecution(request: DispatchJobExecutionToWorkerRequest): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      void dispatchJobExecutionToWorker(request)
        .catch(async (err: unknown) => {
          log.error(`[Job ${request.jobId}] Failed to dispatch to worker`, err);
          await jobStorage.markFailed(request.jobId, 'Worker dispatch failed', 'unknown');
        })
        .finally(resolve);
    });
  });
}
