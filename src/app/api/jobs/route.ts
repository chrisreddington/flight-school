/**
 * Jobs API - Create and List Jobs (web tier, thin proxy)
 *
 * After Phase 2B.2 the web tier owns NO job state. POST proxies the
 * create request to the worker (`POST /api/internal/jobs`), which
 * runs the atomic check-then-create primitive and dispatches the
 * executor. GET proxies the redacted list endpoint.
 *
 * POST /api/jobs - Create a new background job (proxy → worker)
 * GET  /api/jobs - List the caller's jobs (proxy → worker)
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { buildWorkerDispatchCredentials, seedTokenStoreFromJwt } from '@/lib/auth/seed';
import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { captureTracePropagationHeaders } from '@/lib/observability/context-propagation';
import {
  parseClientTriggerFromHeaders,
  toClientTriggerSpanAttributes,
  type ClientTriggerMetadata,
} from '@/lib/observability/trigger-metadata';
import { withUserGuards } from '@/lib/security/guard';
import { guardErrorResponse } from '@/lib/security/http';
import { CHAT_GUARD } from '@/lib/security/route-defaults';
import { trace } from '@opentelemetry/api';
import { NextRequest, NextResponse } from 'next/server';

import { createWorkerJob, listWorkerJobs, type CreateWorkerJobInput } from './worker-client';
import type { DispatchableJobInput, DispatchableJobType } from '@/lib/jobs/dispatch';

const log = logger.withTag('Jobs API');

/** RFC4122 v4 uuid shape (lowercase hex; 4 in version nibble; 8|9|a|b in variant). */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type JobType = DispatchableJobType;
type JobTraceContext = ReturnType<typeof captureTracePropagationHeaders>;

interface CreateJobRequest {
  type: JobType;
  targetId?: string;
  input: TopicRegenerationInput | ChallengeRegenerationInput | GoalRegenerationInput | ChatResponseInput | ChallengeEvaluationInput;
}

function hasTraceContext(traceContext: JobTraceContext): boolean {
  return Object.keys(traceContext).length > 0;
}

function toJobCausalityContext(
  traceContext: JobTraceContext,
  trigger?: ClientTriggerMetadata,
) {
  if (!hasTraceContext(traceContext) && !trigger) {
    return undefined;
  }

  return {
    ...traceContext,
    capturedAt: new Date().toISOString(),
    ...(trigger ? { trigger } : {}),
  };
}

export async function POST(request: NextRequest) {
  try {
    // Per-route guards: job creation is the public edge that initiates AI
    // work (chat-response, regenerations, evaluations). Rate-limit +
    // concurrent-cap + audit live exactly here so the same protections
    // apply whether the user calls `/api/copilot` directly or queues
    // a background job.
    return await withUserGuards(
      { ...CHAT_GUARD, eventType: 'job.create', auditMetadata: { route: '/api/jobs' } },
      async ({ userId }) => handleCreateJob(request, userId),
    );
  } catch (err) {
    const guardResponse = guardErrorResponse(err);
    if (guardResponse) return guardResponse;
    throw err;
  }
}

async function handleCreateJob(request: NextRequest, userId: string) {
  const body = await parseJsonBodyWithFallback<CreateJobRequest>(request, {} as CreateJobRequest);

  if (!body.type) {
    return NextResponse.json({ error: 'Missing job type' }, { status: 400 });
  }

  // Hard precondition: ensure the shared TokenStore has a refresh-capable
  // record for this user before we enqueue any work. Background executors
  // resolve a fresh `ghu_` token from the store at run-time; if the store
  // is unwritable now, the executor will have no credentials later.
  const seedResult = await seedTokenStoreFromJwt(userId);
  if (seedResult.status === 'error') {
    log.error('Refusing to enqueue job: token-store seed failed', {
      userId,
      type: body.type,
      message: seedResult.error.message,
    });
    return NextResponse.json(
      {
        error: 'Credential store temporarily unavailable. Please retry.',
        meta: { reason: 'token-store-seed-failed' },
      },
      { status: 503 },
    );
  }

  const jobId = crypto.randomUUID();
  const traceContext = captureTracePropagationHeaders();
  const triggerMetadata = parseClientTriggerFromHeaders(request.headers);
  if (triggerMetadata) {
    trace.getActiveSpan()?.setAttributes(
      toClientTriggerSpanAttributes(triggerMetadata),
    );
  }
  const causality = toJobCausalityContext(traceContext, triggerMetadata);

  // Phase D — server-validated assistantMessageId for chat jobs. The id
  // is the stable handle the executor's streaming scratchpad uses to
  // reconcile deltas to a single assistant message. The worker enforces
  // the `(threadId, assistantMessageId)` uniqueness inside its atomic
  // create primitive; we just normalise the shape here.
  if (body.type === 'chat-response') {
    const chatInput = body.input as ChatResponseInput | undefined;
    let assistantMessageId = chatInput?.assistantMessageId;

    if (assistantMessageId !== undefined) {
      if (typeof assistantMessageId !== 'string' || !UUID_V4_RE.test(assistantMessageId)) {
        return NextResponse.json(
          { error: 'Invalid assistantMessageId; expected RFC4122 v4 uuid.' },
          { status: 400 },
        );
      }
    } else {
      // Backwards-compat fallback for pre-Phase-D clients.
      assistantMessageId = crypto.randomUUID();
    }

    body.input = { ...chatInput, assistantMessageId } as ChatResponseInput;
  }

  const proxyInput: CreateWorkerJobInput = {
    id: jobId,
    type: body.type,
    targetId: body.targetId,
    userId,
    causality,
    input: body.input as unknown as DispatchableJobInput,
    credentials: await getWorkerDispatchCredentials(),
    traceContext: hasTraceContext(traceContext) ? traceContext : undefined,
  };

  let job;
  try {
    job = await createWorkerJob(proxyInput);
  } catch (err) {
    log.error('Failed to create job on worker', { userId, type: body.type, err });
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
  });
}

async function getWorkerDispatchCredentials() {
  const dispatchCredentialsEnabled =
    process.env.NODE_ENV !== 'production'
    || process.env.COPILOT_WORKER_DISPATCH_CREDENTIALS === '1';

  if (!dispatchCredentialsEnabled) {
    return undefined;
  }

  return (await buildWorkerDispatchCredentials()) ?? undefined;
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const traceContext = captureTracePropagationHeaders();

    const jobs = await listWorkerJobs({
      userId,
      type,
      status,
      traceContext: hasTraceContext(traceContext) ? traceContext : undefined,
    });

    return NextResponse.json({ jobs });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    log.error('Failed to list jobs from worker', { err });
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }
}
