/**
 * Jobs API - Create and List Jobs
 * POST /api/jobs - Create a new background job
 * GET /api/jobs - List all jobs (optional ?type= filter)
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
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
  const body = await parseJsonBodyWithFallback<CreateJobRequest>(request, {} as CreateJobRequest);
  
  if (!body.type) {
    return NextResponse.json({ error: 'Missing job type' }, { status: 400 });
  }
  
  const jobId = crypto.randomUUID();
  
  const job = await jobStorage.create({
    id: jobId,
    type: body.type,
    targetId: body.targetId,
    input: body.input as unknown as Record<string, unknown>,
  });
  
  // Start execution async (fire and forget)
  if (body.type === 'topic-regeneration') {
    setImmediate(() => {
      executeTopicRegeneration(jobId, body.input as TopicRegenerationInput).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'challenge-regeneration') {
    setImmediate(() => {
      executeChallengeRegeneration(jobId, body.input as ChallengeRegenerationInput).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'goal-regeneration') {
    setImmediate(() => {
      executeGoalRegeneration(jobId, body.input as GoalRegenerationInput).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'chat-response') {
    setImmediate(() => {
      executeChatResponse(jobId, body.input as ChatResponseInput).catch(err => {
        log.error(`Unhandled error in job ${jobId}:`, err);
      });
    });
  } else if (body.type === 'challenge-evaluation') {
    setImmediate(() => {
      executeChallengeEvaluation(jobId, body.input as ChallengeEvaluationInput).catch(err => {
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
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const status = searchParams.get('status');
  
  jobStorage.invalidateCache();
  let jobs = type ? await jobStorage.getByType(type) : await jobStorage.getAll();
  
  if (status) {
    jobs = jobs.filter(job => job.status === status);
  }
  
  return NextResponse.json({ jobs });
}
