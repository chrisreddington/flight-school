/**
 * Polling-callback factory for the operations manager.
 *
 * Builds the {@link PollJobCallbacks} closure that translates terminal
 * poll decisions into operation state transitions, completion handlers,
 * and user-supplied onComplete / onError invocations.
 */

import { logger } from '@/lib/logger';

import type { PollJobCallbacks } from './job-poller';
import type { JobResponse } from './job-types';

const log = logger.withTag('OperationsManager');

const COMPLETED_CLEANUP_DELAY_MS = 1000;
const FAILED_CLEANUP_DELAY_MS = 5000;

export interface OperationCallbackHooks {
  releasePoller(jobId: string): void;
  markCompleted(operationId: string, result: unknown): void;
  markFailed(operationId: string, error: string): void;
  cleanup(operationId: string): void;
  runCompletionHandler(job: JobResponse): Promise<void>;
}

/**
 * Returns a {@link PollJobCallbacks} that owns the standard
 * regenerate-style terminal handling: server-registered handler first
 * (durable), user `onComplete` second (best-effort), then delayed
 * cleanup so the snapshot has time to flush.
 */
export function buildJobPollCallbacks(
  jobId: string,
  operationId: string,
  hooks: OperationCallbackHooks,
  onComplete: ((result: unknown) => void | Promise<void>) | undefined,
  onError: ((error: Error) => void) | undefined,
): PollJobCallbacks {
  return {
    onMissing: (error) => {
      log.warn(`Job ${jobId} not found`);
      hooks.releasePoller(jobId);
      hooks.markFailed(operationId, error);
      onError?.(new Error(error));
    },
    onCompleted: async (job) => {
      log.info(`Job ${jobId} completed`);
      hooks.releasePoller(jobId);
      hooks.markCompleted(operationId, job.result);
      await hooks.runCompletionHandler(job);
      if (onComplete && job.result) {
        try {
          await onComplete(job.result);
        } catch (err) {
          log.error('onComplete callback failed (component may have unmounted):', err);
        }
      }
      setTimeout(() => hooks.cleanup(operationId), COMPLETED_CLEANUP_DELAY_MS);
    },
    onCancelled: () => {
      log.info(`Job ${jobId} was cancelled externally`);
      hooks.releasePoller(jobId);
      hooks.cleanup(operationId);
    },
    onFailed: (error) => {
      log.error(`Job ${jobId} failed: ${error}`);
      hooks.releasePoller(jobId);
      hooks.markFailed(operationId, error);
      onError?.(new Error(error));
      setTimeout(() => hooks.cleanup(operationId), FAILED_CLEANUP_DELAY_MS);
    },
    onTimedOut: (error) => {
      log.warn(`Job ${jobId} polling timed out`);
      hooks.releasePoller(jobId);
      hooks.markFailed(operationId, error);
      onError?.(new Error(error));
      setTimeout(() => hooks.cleanup(operationId), FAILED_CLEANUP_DELAY_MS);
    },
    onPollError: (error) => {
      log.error(`Error polling job ${jobId}:`, error);
    },
  };
}
