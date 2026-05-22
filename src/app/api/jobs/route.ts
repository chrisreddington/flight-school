/**
 * Jobs API - Create and List Jobs
 * POST /api/jobs - Create a new background job
 * GET /api/jobs - List all jobs (optional ?type= filter)
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { seedTokenStoreFromJwt } from '@/lib/auth/seed';
import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import { jobStorage } from '@/lib/jobs';
import { redactJobForList } from '@/lib/jobs/redact';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { dispatchJobExecution, type DispatchableJobInput, type DispatchableJobType } from './dispatcher';
import {
  getRegisteredSession,
  unregisterSession,
} from './job-executors';

const log = logger.withTag('Jobs API');

/** RFC4122 v4 uuid shape (lowercase hex; 4 in version nibble; 8|9|a|b in variant). */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type JobType = DispatchableJobType;

interface CreateJobRequest {
  type: JobType;
  targetId?: string;
  input: TopicRegenerationInput | ChallengeRegenerationInput | GoalRegenerationInput | ChatResponseInput | ChallengeEvaluationInput;
}

/** 
 * Cancel a running job by ID.
 * Marks as cancelled in storage and destroys session if available.
 */
export async function cancelRunningJob(jobId: string): Promise<boolean> {
  const job = await jobStorage.get(jobId);
  if (!job) {
    log.debug(`[Job ${jobId}] Job not found in storage`);
    return false;
  }
  
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    log.debug(`[Job ${jobId}] Job already in terminal state: ${job.status}`);
    return false;
  }
  
  log.info(`[Job ${jobId}] Marking job as cancelled in storage`);
  await jobStorage.markCancelled(jobId);
  
  const session = getRegisteredSession(jobId);
  if (session) {
    log.info(`[Job ${jobId}] Destroying Copilot SDK session...`);
    try {
      await session.destroy();
      log.info(`[Job ${jobId}] Copilot SDK session destroyed successfully`);
    } catch (err) {
      log.warn(`[Job ${jobId}] Error destroying session:`, err);
    }
    unregisterSession(jobId);
  } else {
    log.debug(`[Job ${jobId}] No active session to destroy (may be between stages)`);
  }
  
  return true;
}

export async function POST(request: NextRequest) {
  const { userId } = await requireUserContext();
  const body = await parseJsonBodyWithFallback<CreateJobRequest>(request, {} as CreateJobRequest);
  
  if (!body.type) {
    return NextResponse.json({ error: 'Missing job type' }, { status: 400 });
  }

  // Hard precondition: ensure the shared TokenStore has a refresh-capable
  // record for this user before we enqueue any work. Background executors
  // resolve a fresh `ghu_` token from the store at run-time (see
  // resolveFreshGitHubToken); if the store is unwritable now, the executor
  // will have no credentials later and the job will silently fail. Returning
  // 503 here lets the caller retry with backoff.
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

  // Phase D / rubber-duck #9 — server-validated assistantMessageId for
  // chat jobs. The id is the stable handle the executor's streaming
  // scratchpad uses to reconcile deltas to a single assistant message,
  // and the `(threadId, assistantMessageId)` pair is treated as the
  // per-user idempotency key for this endpoint.
  if (body.type === 'chat-response') {
    const chatInput = body.input as ChatResponseInput | undefined;
    const threadId = chatInput?.threadId;
    let assistantMessageId = chatInput?.assistantMessageId;

    if (assistantMessageId !== undefined) {
      if (typeof assistantMessageId !== 'string' || !UUID_V4_RE.test(assistantMessageId)) {
        return NextResponse.json(
          { error: 'Invalid assistantMessageId; expected RFC4122 v4 uuid.' },
          { status: 400 },
        );
      }
    } else {
      // Backwards-compat fallback for pre-Phase-D clients. Once the
      // client always sends an id, this branch can be deleted.
      assistantMessageId = crypto.randomUUID();
    }

    if (threadId) {
      const existing = await jobStorage.getAll();
      const collision = existing.find((j) =>
        j.userId === userId
        && j.type === 'chat-response'
        && (j.status === 'pending' || j.status === 'running')
        && (j.input as { threadId?: string; assistantMessageId?: string } | undefined)?.threadId === threadId
        && (j.input as { threadId?: string; assistantMessageId?: string } | undefined)?.assistantMessageId === assistantMessageId,
      );
      if (collision) {
        log.info('Idempotency hit on chat job; returning existing record', {
          userId,
          threadId,
          assistantMessageId,
          existingJobId: collision.id,
        });
        return NextResponse.json({
          id: collision.id,
          type: collision.type,
          status: collision.status,
          createdAt: collision.createdAt,
        });
      }
    }

    body.input = { ...chatInput, assistantMessageId } as ChatResponseInput;
  }

  const job = await jobStorage.create({
    id: jobId,
    type: body.type,
    targetId: body.targetId,
    userId,
    input: body.input as unknown as Record<string, unknown>,
  });
  
  // Start execution async (fire and forget). Jobs carry only the userId on
  // their payload — the executor resolves a fresh `ghu_` token from the
  // TokenStore at run-time (see resolveFreshGitHubToken) so queued / retried
  // work cannot use a stale access token captured at submission.
  dispatchJobExecution({
    jobId,
    type: body.type,
    input: body.input as DispatchableJobInput,
    userId,
  });
  
  return NextResponse.json({
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
  });
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');

    jobStorage.invalidateCache();
    let jobs = type ? await jobStorage.getByType(type) : await jobStorage.getAll();

    // Multi-tenant invariant: only return jobs owned by the caller.
    jobs = jobs.filter(job => job.userId === userId);

    if (status) {
      jobs = jobs.filter(job => job.status === status);
    }

    return NextResponse.json({ jobs: jobs.map(redactJobForList) });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
