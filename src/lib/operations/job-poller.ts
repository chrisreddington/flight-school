/**
 * Job polling primitive for {@link ActiveOperationsManager}.
 *
 * Owns the GET /api/jobs/[id] loop and surfaces terminal transitions as
 * domain events. Knows nothing about operations, snapshots, or React.
 */

import { apiGet } from '@/lib/api-client';
import { getJobPollingDecision } from './job-polling';
import type { JobResponse } from './job-types';

export interface PollJobOptions {
  jobId: string;
  intervalMs: number;
  timeoutMs: number;
}

export interface PollJobCallbacks {
  onMissing: (error: string) => void;
  onCompleted: (job: JobResponse) => void | Promise<void>;
  onCancelled: () => void;
  onFailed: (error: string) => void;
  onTimedOut: (error: string) => void;
  onPollError: (error: unknown) => void;
}

/**
 * Begins polling `jobId` until a terminal decision fires the matching
 * callback. Returns a stop function the caller invokes once it has
 * processed the terminal transition.
 *
 * @remarks
 * Transient fetch errors do not stop polling — `onPollError` is invoked
 * for observability and the interval continues until a terminal decision
 * or `stop()`.
 */
export function pollJobUntilTerminal(options: PollJobOptions, callbacks: PollJobCallbacks): () => void {
  const { jobId, intervalMs, timeoutMs } = options;
  const startTime = Date.now();
  let stopped = false;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;

  const stop = () => {
    stopped = true;
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const job = await apiGet<JobResponse>(`/api/jobs/${jobId}`);
      const decision = getJobPollingDecision({
        job,
        elapsedMs: Date.now() - startTime,
        timeoutMs,
      });

      if (decision.kind === 'continue') return;
      stop();

      switch (decision.kind) {
        case 'missing':
          callbacks.onMissing(decision.error);
          return;
        case 'completed':
          await callbacks.onCompleted(job);
          return;
        case 'cancelled':
          callbacks.onCancelled();
          return;
        case 'failed':
          callbacks.onFailed(decision.error || 'Job failed');
          return;
        case 'timed-out':
          callbacks.onTimedOut(decision.error);
          return;
      }
    } catch (error) {
      callbacks.onPollError(error);
    }
  };

  void tick();
  intervalHandle = setInterval(tick, intervalMs);
  return stop;
}
