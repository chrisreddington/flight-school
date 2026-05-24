import type { BackgroundJob } from '@/lib/jobs/storage';
import type { JobListDTO } from '@/lib/jobs/redact';
import type {
  DispatchableJobInput,
  DispatchableJobType,
  WorkerDispatchCredentials,
} from '@/lib/jobs/dispatch';
import { workerFetchJson } from '@/lib/copilot/execution/worker-fetch';
import type { TracePropagationHeaders } from '@/lib/observability/context-propagation';

/**
 * Payload for {@link createWorkerJob}. Mirrors the body shape expected
 * by `POST /api/internal/jobs`.
 */
export interface CreateWorkerJobInput {
  id: string;
  type: DispatchableJobType;
  targetId?: string;
  userId: string;
  causality?: Record<string, unknown>;
  input: DispatchableJobInput;
  credentials?: WorkerDispatchCredentials;
  traceContext?: TracePropagationHeaders;
}

/**
 * Create a job record on the worker. Returns the redacted job record;
 * `POST` is idempotent so resubmitting an existing id returns the
 * stored record without re-dispatching.
 */
export async function createWorkerJob(input: CreateWorkerJobInput): Promise<BackgroundJob> {
  const { traceContext, ...body } = input;
  const result = await workerFetchJson<BackgroundJob>(
    '/api/internal/jobs',
    { method: 'POST', body: JSON.stringify(body) },
    { errorContext: 'job create', traceContext },
  );
  return result as BackgroundJob;
}

export interface ListWorkerJobsOptions {
  userId: string;
  type?: string;
  status?: string;
  traceContext?: TracePropagationHeaders;
}

export async function listWorkerJobs(opts: ListWorkerJobsOptions): Promise<JobListDTO[]> {
  const params = new URLSearchParams({ userId: opts.userId });
  if (opts.type) params.set('type', opts.type);
  if (opts.status) params.set('status', opts.status);

  const payload = await workerFetchJson<{ jobs: JobListDTO[] }>(
    `/api/internal/jobs?${params.toString()}`,
    { method: 'GET' },
    { errorContext: 'job list', traceContext: opts.traceContext },
  );
  return payload?.jobs ?? [];
}

export async function getWorkerJob(
  id: string,
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<BackgroundJob | null> {
  const params = new URLSearchParams({ userId });
  return workerFetchJson<BackgroundJob>(
    `/api/internal/jobs/${encodeURIComponent(id)}?${params.toString()}`,
    { method: 'GET' },
    { errorContext: 'job fetch', traceContext, allowNotFound: true },
  );
}

export interface CancelWorkerJobRecordResult {
  cancelled: boolean;
  alreadyTerminal?: boolean;
  status?: string;
  /** True when the worker reported the job missing (404). */
  notFound?: boolean;
}

export async function cancelWorkerJobRecord(
  id: string,
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<CancelWorkerJobRecordResult> {
  const params = new URLSearchParams({ userId });
  const result = await workerFetchJson<CancelWorkerJobRecordResult>(
    `/api/internal/jobs/${encodeURIComponent(id)}?${params.toString()}`,
    { method: 'DELETE' },
    { errorContext: 'job cancel-record', traceContext, allowNotFound: true },
  );
  return result ?? { cancelled: false, notFound: true };
}

export interface SweepWorkerJobsResult {
  staleRunningJobs: { deleted: number; inspected: number };
  orphanJobs: { deleted: number; inspected: number };
  redactedTerminalJobs: { deleted: number; inspected: number };
}

export async function sweepWorkerJobs(
  opts: { nowMs?: number; traceContext?: TracePropagationHeaders } = {},
): Promise<SweepWorkerJobsResult> {
  const body = opts.nowMs !== undefined ? JSON.stringify({ nowMs: opts.nowMs }) : '{}';
  const result = await workerFetchJson<SweepWorkerJobsResult>(
    '/api/internal/jobs/sweep',
    { method: 'POST', body },
    { errorContext: 'job sweep', traceContext: opts.traceContext },
  );
  return result as SweepWorkerJobsResult;
}

export async function exportWorkerJobsForUser(
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<BackgroundJob[]> {
  const params = new URLSearchParams({ userId });
  const payload = await workerFetchJson<{ jobs: BackgroundJob[] }>(
    `/api/internal/jobs/user-data?${params.toString()}`,
    { method: 'GET' },
    { errorContext: 'job export', traceContext },
  );
  return payload?.jobs ?? [];
}

export async function deleteWorkerJobsForUser(
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<{ deleted: number; cancelled: number }> {
  const result = await workerFetchJson<{ deleted: number; cancelled: number }>(
    `/api/internal/jobs/user-data?${new URLSearchParams({ userId }).toString()}`,
    { method: 'DELETE' },
    { errorContext: 'job delete-for-user', traceContext },
  );
  return result as { deleted: number; cancelled: number };
}
