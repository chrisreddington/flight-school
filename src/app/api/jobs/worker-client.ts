import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import type { BackgroundJob } from '@/lib/jobs/storage';
import type { JobListDTO } from '@/lib/jobs/redact';
import type {
  DispatchableJobInput,
  DispatchableJobType,
  WorkerDispatchCredentials,
} from '@/lib/jobs/dispatch';
import {
  mergeTracePropagationHeaders,
  type TracePropagationHeaders,
} from '@/lib/observability/context-propagation';

function getRequiredWorkerConfig() {
  const config = getCopilotWorkerConfig();
  if (!config) {
    throw new Error('Copilot worker is required for background job execution');
  }
  return config;
}

function buildHeaders(secret: string, traceContext?: TracePropagationHeaders) {
  return mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    traceContext ?? {},
  );
}

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
  const config = getRequiredWorkerConfig();
  const { traceContext, ...body } = input;
  const headers = buildHeaders(config.secret, traceContext);

  const response = await fetch(`${config.baseUrl}/api/internal/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job create failed with HTTP ${response.status}`);
  }
  return (await response.json()) as BackgroundJob;
}

export interface ListWorkerJobsOptions {
  userId: string;
  type?: string;
  status?: string;
  traceContext?: TracePropagationHeaders;
}

export async function listWorkerJobs(opts: ListWorkerJobsOptions): Promise<JobListDTO[]> {
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, opts.traceContext);

  const params = new URLSearchParams({ userId: opts.userId });
  if (opts.type) params.set('type', opts.type);
  if (opts.status) params.set('status', opts.status);

  const response = await fetch(`${config.baseUrl}/api/internal/jobs?${params.toString()}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job list failed with HTTP ${response.status}`);
  }
  const data = (await response.json()) as { jobs: JobListDTO[] };
  return data.jobs ?? [];
}

export async function getWorkerJob(
  id: string,
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<BackgroundJob | null> {
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, traceContext);

  const params = new URLSearchParams({ userId });
  const response = await fetch(
    `${config.baseUrl}/api/internal/jobs/${encodeURIComponent(id)}?${params.toString()}`,
    { method: 'GET', headers },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Copilot worker job fetch failed with HTTP ${response.status}`);
  }
  return (await response.json()) as BackgroundJob;
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
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, traceContext);

  const params = new URLSearchParams({ userId });
  const response = await fetch(
    `${config.baseUrl}/api/internal/jobs/${encodeURIComponent(id)}?${params.toString()}`,
    { method: 'DELETE', headers },
  );

  if (response.status === 404) {
    return { cancelled: false, notFound: true };
  }
  if (!response.ok) {
    throw new Error(`Copilot worker job cancel-record failed with HTTP ${response.status}`);
  }
  return (await response.json()) as CancelWorkerJobRecordResult;
}

export interface SweepWorkerJobsResult {
  staleRunningJobs: { deleted: number; inspected: number };
  orphanJobs: { deleted: number; inspected: number };
  redactedTerminalJobs: { deleted: number; inspected: number };
}

export async function sweepWorkerJobs(
  opts: { nowMs?: number; traceContext?: TracePropagationHeaders } = {},
): Promise<SweepWorkerJobsResult> {
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, opts.traceContext);

  const body = opts.nowMs !== undefined ? JSON.stringify({ nowMs: opts.nowMs }) : '{}';
  const response = await fetch(`${config.baseUrl}/api/internal/jobs/sweep`, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job sweep failed with HTTP ${response.status}`);
  }
  return (await response.json()) as SweepWorkerJobsResult;
}

export async function exportWorkerJobsForUser(
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<BackgroundJob[]> {
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, traceContext);

  const params = new URLSearchParams({ userId });
  const response = await fetch(`${config.baseUrl}/api/internal/jobs/user-data?${params.toString()}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job export failed with HTTP ${response.status}`);
  }
  const data = (await response.json()) as { jobs: BackgroundJob[] };
  return data.jobs ?? [];
}

export async function deleteWorkerJobsForUser(
  userId: string,
  traceContext?: TracePropagationHeaders,
): Promise<{ deleted: number; cancelled: number }> {
  const config = getRequiredWorkerConfig();
  const headers = buildHeaders(config.secret, traceContext);

  const params = new URLSearchParams({ userId });
  const response = await fetch(`${config.baseUrl}/api/internal/jobs/user-data?${params.toString()}`, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    throw new Error(`Copilot worker job delete-for-user failed with HTTP ${response.status}`);
  }
  return (await response.json()) as { deleted: number; cancelled: number };
}
