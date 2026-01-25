/**
 * Jobs API - Create and List Jobs
 * POST /api/jobs - Create a new background job
 * GET /api/jobs - List all jobs (optional ?type= filter)
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import { jobStorage } from '@/lib/jobs';
import type { 
  TopicRegenerationInput, 
  TopicRegenerationResult,
  ChallengeRegenerationInput,
  ChallengeRegenerationResult,
  GoalRegenerationInput,
  GoalRegenerationResult,
} from '@/lib/jobs';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import type { SkillProfile } from '@/lib/skills/types';
import {
  buildSingleTopicPrompt,
  buildSingleChallengePrompt,
  buildSingleGoalPrompt,
} from '@/lib/copilot/prompts';
import {
  createLoggedLightweightCoachSession,
} from '@/lib/copilot/server';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { extractJSON } from '@/lib/utils/json-utils';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Jobs API');

interface CreateJobRequest {
  type: 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration';
  targetId?: string;
  input: TopicRegenerationInput | ChallengeRegenerationInput | GoalRegenerationInput;
}

/**
 * Execute a topic regeneration job.
 * This runs async - the job is marked running, then completed/failed.
 */
async function executeTopicRegeneration(
  jobId: string,
  input: TopicRegenerationInput
): Promise<void> {
  jobStorage.markRunning(jobId);
  
  try {
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Build and send prompt
    const prompt = buildSingleTopicPrompt(
      serializedContext, 
      input.existingTopicTitles, 
      input.skillProfile
    );
    
    const loggedSession = await createLoggedLightweightCoachSession(
      'Job: topic-regeneration',
      prompt.slice(0, 50)
    );
    
    log.info(`[Job ${jobId}] Sending prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    loggedSession.destroy();
    
    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);
    
    // Parse result
    const parsed = extractJSON<{ learningTopic: LearningTopic }>(result.responseText);
    if (!parsed?.learningTopic) {
      throw new Error('Failed to parse topic response');
    }
    
    // Add ID if missing
    if (!parsed.learningTopic.id) {
      parsed.learningTopic.id = crypto.randomUUID();
    }
    
    // Mark completed
    jobStorage.markCompleted<TopicRegenerationResult>(jobId, {
      learningTopic: parsed.learningTopic,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a challenge regeneration job.
 */
async function executeChallengeRegeneration(
  jobId: string,
  input: ChallengeRegenerationInput
): Promise<void> {
  jobStorage.markRunning(jobId);
  
  try {
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Build and send prompt
    const prompt = buildSingleChallengePrompt(
      serializedContext, 
      input.existingChallengeTitles, 
      input.skillProfile
    );
    
    const loggedSession = await createLoggedLightweightCoachSession(
      'Job: challenge-regeneration',
      prompt.slice(0, 50)
    );
    
    log.info(`[Job ${jobId}] Sending challenge prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    loggedSession.destroy();
    
    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);
    
    // Parse result
    const parsed = extractJSON<{ challenge: DailyChallenge }>(result.responseText);
    if (!parsed?.challenge) {
      throw new Error('Failed to parse challenge response');
    }
    
    // Add ID if missing
    if (!parsed.challenge.id) {
      parsed.challenge.id = crypto.randomUUID();
    }
    
    // Mark completed
    jobStorage.markCompleted<ChallengeRegenerationResult>(jobId, {
      challenge: parsed.challenge,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a goal regeneration job.
 */
async function executeGoalRegeneration(
  jobId: string,
  input: GoalRegenerationInput
): Promise<void> {
  jobStorage.markRunning(jobId);
  
  try {
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Build and send prompt
    const prompt = buildSingleGoalPrompt(
      serializedContext, 
      input.existingGoalTitles, 
      input.skillProfile
    );
    
    const loggedSession = await createLoggedLightweightCoachSession(
      'Job: goal-regeneration',
      prompt.slice(0, 50)
    );
    
    log.info(`[Job ${jobId}] Sending goal prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    loggedSession.destroy();
    
    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);
    
    // Parse result
    const parsed = extractJSON<{ goal: DailyGoal }>(result.responseText);
    if (!parsed?.goal) {
      throw new Error('Failed to parse goal response');
    }
    
    // Add ID if missing
    if (!parsed.goal.id) {
      parsed.goal.id = crypto.randomUUID();
    }
    
    // Mark completed
    jobStorage.markCompleted<GoalRegenerationResult>(jobId, {
      goal: parsed.goal,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    jobStorage.markFailed(jobId, errorMessage);
  }
}

export async function POST(request: NextRequest) {
  const body = await parseJsonBodyWithFallback<CreateJobRequest>(request, {} as CreateJobRequest);
  
  if (!body.type) {
    return NextResponse.json({ error: 'Missing job type' }, { status: 400 });
  }
  
  // Generate job ID
  const jobId = crypto.randomUUID();
  
  // Create job record
  const job = jobStorage.create({
    id: jobId,
    type: body.type,
    targetId: body.targetId,
    input: body.input as unknown as Record<string, unknown>,
  });
  
  // Start execution async (don't await - fire and forget)
  // Use setImmediate to ensure the response is sent first
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
  }
  
  // Return job info immediately
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
  
  let jobs = type ? jobStorage.getByType(type) : jobStorage.getAll();
  
  if (status) {
    jobs = jobs.filter(job => job.status === status);
  }
  
  return NextResponse.json({ jobs });
}
