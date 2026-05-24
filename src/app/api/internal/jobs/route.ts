/**
 * Internal worker endpoint for the jobs collection.
 *
 * `POST /api/internal/jobs` — create (or idempotently replay) a job
 * record. The web edge captures causality and pre-validates the
 * payload before forwarding here; this route is the single writer of
 * job records.
 *
 * `GET /api/internal/jobs?userId=&type=&status=` — list redacted
 * job DTOs scoped to a user. Mirrors the multi-tenant filter on
 * `/api/jobs`.
 *
 * All requests require Bearer auth (`COPILOT_WORKER_SECRET`) and
 * `COPILOT_WORKER_MODE=1`.
 */

import { parseJsonBody } from '@/lib/api/request-utils';
import { getTokenStore } from '@/lib/auth/token-store';
import { jobStorage } from '@/lib/jobs';
import type { BackgroundJob } from '@/lib/jobs/storage';
import type {
  DispatchableJobInput,
  DispatchableJobType,
  WorkerDispatchCredentials,
} from '@/lib/jobs/dispatch';
import { redactJobForDetail, redactJobForList } from '@/lib/jobs/redact';
import { logger } from '@/lib/logger';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { scheduleWorkerJobExecution } from '@/worker/jobs/scheduler';

const log = logger.withTag('InternalJobs');

/** RFC4122 v4 uuid shape (lowercase hex). Matches `/api/jobs` validator. */
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

interface CreateJobBody {
  id: string;
  type: DispatchableJobType;
  targetId?: string;
  userId: string;
  causality?: Record<string, unknown>;
  input: DispatchableJobInput;
  credentials?: WorkerDispatchCredentials;
}

function parseCreateBody(requestBody: unknown):
  | { ok: true; body: CreateJobBody }
  | { ok: false } {
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

function authorize(request: NextRequest): NextResponse | null {
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
  return null;
}

/**
 * Pre-flight ownership check so cross-user id collisions return a clean 409.
 * The atomic `createIfAbsent` also detects this, but only by failing the
 * insert — without this read we'd lose the distinction between cross-user
 * conflict and same-user idempotent replay in the response code.
 */
async function rejectIfOwnedByDifferentUser(
  body: CreateJobBody,
): Promise<NextResponse | null> {
  const preExisting = await jobStorage.get(body.id);
  if (preExisting && preExisting.userId !== body.userId) {
    return NextResponse.json({ error: 'Conflict' }, { status: 409 });
  }
  return null;
}

/**
 * For chat-response jobs only: build a predicate that flags an in-flight
 * job targeting the same (threadId, assistantMessageId) tuple as a collision.
 * Returning `undefined` skips the tuple check inside `createIfAbsent`.
 */
function buildChatTupleCollisionFinder(
  body: CreateJobBody,
): ((jobs: Readonly<Record<string, BackgroundJob>>) => BackgroundJob | undefined) | undefined {
  if (body.type !== 'chat-response') return undefined;
  const input = body.input as { threadId?: unknown; assistantMessageId?: unknown };
  const threadId = typeof input.threadId === 'string' ? input.threadId : undefined;
  const assistantMessageId =
    typeof input.assistantMessageId === 'string' ? input.assistantMessageId : undefined;
  if (!threadId || !assistantMessageId) return undefined;

  return (jobs) => {
    for (const candidate of Object.values(jobs)) {
      if (candidate.userId !== body.userId) continue;
      if (candidate.type !== 'chat-response') continue;
      if (candidate.status !== 'pending' && candidate.status !== 'running') continue;
      const candidateInput = candidate.input as
        | { threadId?: string; assistantMessageId?: string }
        | undefined;
      if (
        candidateInput?.threadId === threadId
        && candidateInput?.assistantMessageId === assistantMessageId
      ) {
        return candidate;
      }
    }
    return undefined;
  };
}

/**
 * Schedule executor on the next tick. Errors here mark the SAME job failed
 * so the polling client sees a deterministic terminal state instead of a
 * permanently `pending` row.
 */
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

async function handleCreate(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  const parsed = parseCreateBody(parseResult.data);
  if (!parsed.ok) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }
  const body = parsed.body;

  const ownershipConflict = await rejectIfOwnedByDifferentUser(body);
  if (ownershipConflict) return ownershipConflict;

  if (body.credentials) {
    await getTokenStore().setTokenIfNewer(body.userId, body.credentials);
  }

  // Atomic check-then-create — both id and chat-tuple collisions run under
  // the same `withJobsMutation` lock as the insert. See `createIfAbsent`.
  const causality = body.causality as
    | (Record<string, unknown> & { capturedAt?: string })
    | undefined;
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

  // Idempotent replay path: same id or chat-collision tuple won the race.
  if (!outcome.created) {
    if (outcome.existing.userId !== body.userId) {
      return NextResponse.json({ error: 'Conflict' }, { status: 409 });
    }
    return NextResponse.json(redactJobForDetail(outcome.existing), { status: 200 });
  }

  dispatchExecutorOnNextTick(outcome.job, body);
  return NextResponse.json(redactJobForDetail(outcome.job), { status: 202 });
}

async function handleList(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  jobStorage.invalidateCache();
  let jobs = type ? await jobStorage.getByType(type) : await jobStorage.getAll();
  jobs = jobs.filter((job) => job.userId === userId);
  if (status) jobs = jobs.filter((job) => job.status === status);

  return NextResponse.json({ jobs: jobs.map(redactJobForList) });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleCreate(request));
}

export async function GET(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleList(request));
}
