/**
 * Jobs API - Create and List Jobs (web tier, thin proxy)
 *
 * The web tier owns NO job state. POST proxies the create request to the
 * worker (`POST /api/internal/jobs`), which runs the atomic
 * check-then-create primitive and dispatches the executor. GET proxies the
 * redacted list endpoint.
 *
 * POST /api/jobs - Create a new background job (proxy → worker)
 * GET  /api/jobs - List the caller's jobs (proxy → worker)
 */

import { authErrorResponse, parseJsonBodyWithFallback } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
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
import { withGuardedRoute } from '@/lib/security/guard';
import { CHAT_GUARD } from '@/lib/security/route-defaults';
import { trace } from '@opentelemetry/api';
import { NextRequest, NextResponse } from 'next/server';

import { createWorkerJob, listWorkerJobs, type CreateWorkerJobInput } from './worker-client';
import type { DispatchableJobInput, DispatchableJobType } from '@/lib/jobs/dispatch';
import {
  areCapabilitiesAllowedForProfile,
  isChatResponseProfile,
  isCapabilitiesArg,
  CHAT_RESPONSE_PROFILES,
  type CapabilitiesArg,
} from '@/lib/copilot/profile-types';

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
  // Per-route guards: job creation is the public edge that initiates AI
  // work (chat-response, regenerations, evaluations). Rate-limit +
  // concurrent-cap + audit live exactly here so the same protections
  // apply whether the user calls `/api/copilot` directly or queues
  // a background job.
  return withGuardedRoute(
    { ...CHAT_GUARD, eventType: 'job.create', auditMetadata: { route: '/api/jobs' } },
    async ({ userId }) => handleCreateJob(request, userId),
  );
}

/**
 * Hard precondition: ensure the shared TokenStore has a refresh-capable
 * record for this user before we enqueue any work. Background executors
 * resolve a fresh `ghu_` token from the store at run-time; if the store
 * is unwritable now, the executor will have no credentials later.
 */
async function ensureTokenStoreSeeded(
  userId: string,
  jobType: JobType,
): Promise<NextResponse | null> {
  const seedResult = await seedTokenStoreFromJwt(userId);
  if (seedResult.status === 'error') {
    log.error('Refusing to enqueue job: token-store seed failed', {
      userId,
      type: jobType,
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
  return null;
}

/**
 * Validate the chat-response wire shape: `input.profile` must be a chat
 * surface (`chat` | `learning` — the only profiles the streaming worker
 * supports), and `input.capabilities` (if present) must be `'auto'` or
 * an array of valid capability ids that all sit within the profile's
 * allowlist. Rejecting here keeps doomed requests off the worker.
 */
function validateChatResponseProfile(
  body: CreateJobRequest,
): { ok: true } | { ok: false; response: NextResponse } {
  if (body.type !== 'chat-response') return { ok: true };
  const chatInput = body.input as ChatResponseInput | undefined;
  if (!chatInput || !isChatResponseProfile(chatInput.profile)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            `Invalid 'profile' for chat-response: must be one of `
            + `${CHAT_RESPONSE_PROFILES.join(' | ')}.`,
        },
        { status: 400 },
      ),
    };
  }
  if (chatInput.capabilities !== undefined && !isCapabilitiesArg(chatInput.capabilities)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid 'capabilities': must be 'auto' or an array of capability ids." },
        { status: 400 },
      ),
    };
  }
  if (
    !areCapabilitiesAllowedForProfile(
      chatInput.profile,
      chatInput.capabilities as CapabilitiesArg | undefined,
    )
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `One or more capabilities are not allowed by profile '${chatInput.profile}'.` },
        { status: 400 },
      ),
    };
  }
  return { ok: true };
}

/**
 * Server-validated `assistantMessageId` for chat jobs. The id is the
 * stable handle the worker uses to upsert deltas into a single assistant
 * message on `threads.json`. The worker enforces the
 * `(threadId, assistantMessageId)` uniqueness inside its atomic create;
 * we just normalise the shape here (or fall back to a fresh uuid for
 * older clients).
 */
function normalizeChatAssistantMessageId(
  body: CreateJobRequest,
): { ok: true; body: CreateJobRequest } | { ok: false; response: NextResponse } {
  if (body.type !== 'chat-response') return { ok: true, body };

  const chatInput = body.input as ChatResponseInput | undefined;
  let assistantMessageId = chatInput?.assistantMessageId;

  if (assistantMessageId !== undefined) {
    if (typeof assistantMessageId !== 'string' || !UUID_V4_RE.test(assistantMessageId)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Invalid assistantMessageId; expected RFC4122 v4 uuid.' },
          { status: 400 },
        ),
      };
    }
  } else {
    assistantMessageId = crypto.randomUUID();
  }

  return {
    ok: true,
    body: { ...body, input: { ...chatInput, assistantMessageId } as ChatResponseInput },
  };
}

function recordTriggerOnActiveSpan(request: NextRequest): ClientTriggerMetadata | undefined {
  const triggerMetadata = parseClientTriggerFromHeaders(request.headers);
  if (triggerMetadata) {
    trace.getActiveSpan()?.setAttributes(toClientTriggerSpanAttributes(triggerMetadata));
  }
  return triggerMetadata;
}

async function handleCreateJob(request: NextRequest, userId: string) {
  const body = await parseJsonBodyWithFallback<CreateJobRequest>(request, {} as CreateJobRequest);

  if (!body.type) {
    return NextResponse.json({ error: 'Missing job type' }, { status: 400 });
  }

  // Validate profile BEFORE the token-store seed so a 400 (bad payload)
  // is never masked as a 503 (credential store unavailable).
  const normalized = normalizeChatAssistantMessageId(body);
  if (!normalized.ok) return normalized.response;
  const profileCheck = validateChatResponseProfile(normalized.body);
  if (!profileCheck.ok) return profileCheck.response;
  const finalBody = normalized.body;

  const seedError = await ensureTokenStoreSeeded(userId, finalBody.type);
  if (seedError) return seedError;

  const jobId = crypto.randomUUID();
  const traceContext = captureTracePropagationHeaders();
  const triggerMetadata = recordTriggerOnActiveSpan(request);
  const causality = toJobCausalityContext(traceContext, triggerMetadata);

  const proxyInput: CreateWorkerJobInput = {
    id: jobId,
    type: finalBody.type,
    targetId: finalBody.targetId,
    userId,
    causality,
    input: finalBody.input as unknown as DispatchableJobInput,
    credentials: await getWorkerDispatchCredentials(),
    traceContext: hasTraceContext(traceContext) ? traceContext : undefined,
  };

  let job;
  try {
    job = await createWorkerJob(proxyInput);
  } catch (err) {
    log.error('Failed to create job on worker', { userId, type: finalBody.type, err });
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
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    log.error('Failed to list jobs from worker', { err });
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }
}
