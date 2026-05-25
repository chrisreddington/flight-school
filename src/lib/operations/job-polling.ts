interface PollingJob {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}

interface JobPollingDecisionOptions {
  job: PollingJob | null;
  elapsedMs: number;
  timeoutMs: number;
}

type JobPollingDecision =
  | { kind: 'completed' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error?: string }
  | { kind: 'missing'; error: string }
  | { kind: 'timed-out'; error: string }
  | { kind: 'continue' };

export function getJobPollingDecision({ job, elapsedMs, timeoutMs }: JobPollingDecisionOptions): JobPollingDecision {
  if (!job) return { kind: 'missing', error: 'Job not found' };
  if (job.status === 'completed') return { kind: 'completed' };
  if (job.status === 'cancelled') return { kind: 'cancelled' };
  if (job.status === 'failed') return { kind: 'failed', error: job.error };
  if (elapsedMs > timeoutMs) return { kind: 'timed-out', error: 'Operation timed out' };
  return { kind: 'continue' };
}
