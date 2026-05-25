/**
 * Handlers for `/api/internal/jobs` — list (GET) and create (POST).
 *
 * Faithfully ports `src/app/api/internal/jobs/route.ts`, minus the
 * env-mode/bearer check (handled by Hono middleware) and Next types.
 */

import { parseJsonBody } from '@/lib/api/request-utils';
import { getTokenStore } from '@/lib/auth/token-store';
import { jobStorage } from '@/lib/jobs';
import type { BackgroundJob } from '@/lib/jobs/storage';
import type { DispatchableJobInput, DispatchableJobType, WorkerDispatchCredentials } from '@/lib/jobs/dispatch';
import { redactJobForDetail, redactJobForList } from '@/lib/jobs/redact';
import { logger } from '@/lib/logger';
import {
  areCapabilitiesAllowedForProfile,
  isChatResponseProfile,
  isCapabilitiesArg,
  type CapabilitiesArg,
} from '@/lib/copilot/profile-types';

import { scheduleWorkerJobExecution } from '@/worker/jobs/scheduler';

const log = logger.withTag('InternalJobs');

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function parseCredentials(value: unknown): WorkerDispatchCredentials | null | 'invalid' {
  if (value === undefined) return null;
  if (typeof value !== 'object' || value === null) return 'invalid';
  const raw = value as Partial<WorkerDispatchCredentials>;
  if (
    typeof raw.accessToken !== 'string' ||
    typeof raw.refreshToken !== 'string' ||
    typeof raw.expiresAt !== 'number' ||
    !Number.isFinite(raw.expiresAt) ||
    raw.expiresAt <= 0
  ) {
    return 'invalid';
  }
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt: raw.expiresAt,
  };
}

interface CreateJobBody {
  id: string;
  type: DispatchableJobType;
  targetId?: string;
  userId: string;
  causality?: Record<string, unknown>;
  input: DispatchableJobInput;
  credentials?: WorkerDispatchCredentials;
}

function parseCreateBody(requestBody: unknown): { ok: true; body: CreateJobBody } | { ok: false } {
  if (typeof requestBody !== 'object' || requestBody === null) return { ok: false };
  const raw = requestBody as Partial<CreateJobBody> & { credentials?: unknown };
  if (typeof raw.id !== 'string' || !UUID_V4_RE.test(raw.id)) return { ok: false };
  if (!isDispatchableJobType(raw.type)) return { ok: false };
  if (typeof raw.userId !== 'string' || raw.userId.length === 0) return { ok: false };
  if (raw.input === undefined || raw.input === null || typeof raw.input !== 'object') {
    return { ok: false };
  }
  if (raw.targetId !== undefined && typeof raw.targetId !== 'string') return { ok: false };
  if (raw.causality !== undefined && (typeof raw.causality !== 'object' || raw.causality === null)) {
    return { ok: false };
  }
  const credentials = parseCredentials(raw.credentials);
  if (credentials === 'invalid') return { ok: false };
  if (raw.type === 'chat-response') {
    const chatInput = raw.input as { profile?: unknown; capabilities?: unknown };
    if (!isChatResponseProfile(chatInput.profile)) return { ok: false };
    if (chatInput.capabilities !== undefined && !isCapabilitiesArg(chatInput.capabilities)) {
      return { ok: false };
    }
    if (!areCapabilitiesAllowedForProfile(chatInput.profile, chatInput.capabilities as CapabilitiesArg | undefined)) {
      return { ok: false };
    }
  }
  return {
    ok: true,
    body: {
      id: raw.id,
      type: raw.type,
      targetId: raw.targetId,
      userId: raw.userId,
      causality: raw.causality as Record<string, unknown> | undefined,
      input: raw.input as DispatchableJobInput,
      credentials: credentials ?? undefined,
    },
  };
}

async function rejectIfOwnedByDifferentUser(body: CreateJobBody): Promise<Response | null> {
  const preExisting = await jobStorage.get(body.id);
  if (preExisting && preExisting.userId !== body.userId) {
    return Response.json({ error: 'Conflict' }, { status: 409 });
  }
  return null;
}

function buildChatTupleCollisionFinder(
  body: CreateJobBody,
): ((jobs: Readonly<Record<string, BackgroundJob>>) => BackgroundJob | undefined) | undefined {
  if (body.type !== 'chat-response') return undefined;
  const input = body.input as { threadId?: unknown; assistantMessageId?: unknown };
  const threadId = typeof input.threadId === 'string' ? input.threadId : undefined;
  const assistantMessageId = typeof input.assistantMessageId === 'string' ? input.assistantMessageId : undefined;
  if (!threadId || !assistantMessageId) return undefined;
  return (jobs) => {
    for (const candidate of Object.values(jobs)) {
      if (candidate.userId !== body.userId) continue;
      if (candidate.type !== 'chat-response') continue;
      if (candidate.status !== 'pending' && candidate.status !== 'running') continue;
      const candidateInput = candidate.input as { threadId?: string; assistantMessageId?: string } | undefined;
      if (candidateInput?.threadId === threadId && candidateInput?.assistantMessageId === assistantMessageId) {
        return candidate;
      }
    }
    return undefined;
  };
}

function dispatchExecutorOnNextTick(job: BackgroundJob, body: CreateJobBody): void {
  setImmediate(() => {
    try {
      scheduleWorkerJobExecution(
        {
          jobId: job.id,
          type: job.type as DispatchableJobType,
          input: body.input as DispatchableJobInput,
          userId: job.userId,
        },
        job.causality,
      );
    } catch (err) {
      log.error('Worker executor setup failed', { jobId: job.id, error: err });
      void jobStorage.markFailed(job.id, 'Worker executor setup failed', 'unknown');
    }
  });
}

export async function handleJobsCreate(request: Request): Promise<Response> {
  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  const parsed = parseCreateBody(parseResult.data);
  if (!parsed.ok) {
    return Response.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  const body = parsed.body;

  const ownershipConflict = await rejectIfOwnedByDifferentUser(body);
  if (ownershipConflict) return ownershipConflict;

  if (body.credentials) {
    await getTokenStore().setTokenIfNewer(body.userId, body.credentials);
  }

  const causality = body.causality as (Record<string, unknown> & { capturedAt?: string }) | undefined;
  const outcome = await jobStorage.createIfAbsent(
    {
      id: body.id,
      type: body.type,
      targetId: body.targetId,
      userId: body.userId,
      causality: causality as never,
      input: body.input as unknown as Record<string, unknown>,
    },
    buildChatTupleCollisionFinder(body),
  );

  if (!outcome.created) {
    if (outcome.existing.userId !== body.userId) {
      return Response.json({ error: 'Conflict' }, { status: 409 });
    }
    return Response.json(redactJobForDetail(outcome.existing), { status: 200 });
  }

  dispatchExecutorOnNextTick(outcome.job, body);
  return Response.json(redactJobForDetail(outcome.job), { status: 202 });
}

export async function handleJobsList(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  if (!userId) {
    return Response.json({ error: 'userId is required' }, { status: 400 });
  }

  jobStorage.invalidateCache();
  let jobs = type ? await jobStorage.getByType(type) : await jobStorage.getAll();
  jobs = jobs.filter((job) => job.userId === userId);
  if (status) jobs = jobs.filter((job) => job.status === status);

  return Response.json({ jobs: jobs.map(redactJobForList) });
}
