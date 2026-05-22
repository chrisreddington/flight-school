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
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import {
  executeChallengeEvaluation,
  executeChallengeRegeneration,
  executeChatResponse,
  executeGoalRegeneration,
  executeTopicRegeneration,
  getRegisteredSession,
  unregisterSession,
} from './job-executors';

const log = logger.withTag('Jobs API');

type JobType = 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'chat-response' | 'challenge-evaluation';

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
  if (body.type === 'topic-regeneration') {
    setImmediate(() => {
      executeTopicRegeneration(jobId, body.input as TopicRegenerationInput, userId).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'challenge-regeneration') {
    setImmediate(() => {
      executeChallengeRegeneration(jobId, body.input as ChallengeRegenerationInput, userId).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'goal-regeneration') {
    setImmediate(() => {
      executeGoalRegeneration(jobId, body.input as GoalRegenerationInput, userId).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'chat-response') {
    setImmediate(() => {
      executeChatResponse(jobId, body.input as ChatResponseInput, userId).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'challenge-evaluation') {
    setImmediate(() => {
      executeChallengeEvaluation(jobId, body.input as ChallengeEvaluationInput, userId).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  }
  
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

    return NextResponse.json({ jobs });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
