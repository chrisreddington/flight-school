import { parseJsonBody } from '@/lib/api/request-utils';
import { getTokenStore } from '@/lib/auth/token-store';
import { jobStorage } from '@/lib/jobs';
import type {
  DispatchJobExecutionRequest,
  DispatchJobExecutionToWorkerRequest,
  DispatchableJobType,
  WorkerDispatchCredentials,
} from '@/lib/jobs/dispatch';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { scheduleWorkerJobExecution } from './executor';

const DISPATCHABLE_JOB_TYPES: DispatchableJobType[] = [
  'topic-regeneration',
  'challenge-regeneration',
  'goal-regeneration',
  'chat-response',
  'challenge-evaluation',
];

function isDispatchableJobType(value: unknown): value is DispatchableJobType {
  return typeof value === 'string' && DISPATCHABLE_JOB_TYPES.includes(value as DispatchableJobType);
}

function parseWorkerCredentials(value: unknown): WorkerDispatchCredentials | null | 'invalid' {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null) return 'invalid';

  const raw = value as Partial<WorkerDispatchCredentials>;
  if (
    typeof raw.accessToken !== 'string'
    || typeof raw.refreshToken !== 'string'
    || typeof raw.expiresAt !== 'number'
    || !Number.isFinite(raw.expiresAt)
    || raw.expiresAt <= 0
  ) {
    return 'invalid';
  }

  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt: raw.expiresAt,
  };
}

function parseDispatchRequest(data: unknown): DispatchJobExecutionToWorkerRequest | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as Partial<DispatchJobExecutionToWorkerRequest>;
  if (
    typeof raw.jobId !== 'string'
    || !isDispatchableJobType(raw.type)
    || typeof raw.userId !== 'string'
    || raw.input === undefined
  ) {
    return null;
  }

  const credentials = parseWorkerCredentials(raw.credentials);
  if (credentials === 'invalid') return null;

  return {
    jobId: raw.jobId,
    type: raw.type,
    input: raw.input,
    userId: raw.userId,
    credentials: credentials ?? undefined,
  };
}

function toDispatchRequest(
  request: DispatchJobExecutionToWorkerRequest,
): DispatchJobExecutionRequest {
  return {
    jobId: request.jobId,
    type: request.type,
    input: request.input,
    userId: request.userId,
  };
}

async function handleExecuteRequest(request: NextRequest) {
  if (process.env.COPILOT_WORKER_MODE !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'COPILOT_WORKER_SECRET is not configured' }, { status: 500 });
  }

  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  const dispatchRequest = parseDispatchRequest(parseResult.data);
  if (!dispatchRequest) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  const job = await jobStorage.get(dispatchRequest.jobId);
  if (!job || job.userId !== dispatchRequest.userId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status !== 'pending') {
    return NextResponse.json({ accepted: true, replayed: true }, { status: 202 });
  }

  if (dispatchRequest.credentials) {
    const store = getTokenStore();
    await store.setTokenIfNewer(dispatchRequest.userId, dispatchRequest.credentials);
  }

  await jobStorage.markRunning(dispatchRequest.jobId);
  scheduleWorkerJobExecution(toDispatchRequest(dispatchRequest), job.causality);

  return NextResponse.json({ accepted: true }, { status: 202 });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleExecuteRequest(request));
}
