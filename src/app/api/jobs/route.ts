/**
 * Jobs API - Create and List Jobs
 * POST /api/jobs - Create a new background job
 * GET /api/jobs - List all jobs (optional ?type= filter)
 */

import { parseJsonBodyWithFallback } from '@/lib/api';
import {
    buildSingleChallengePrompt,
    buildSingleGoalPrompt,
    buildSingleTopicPrompt,
} from '@/lib/copilot/prompts';
import {
    createLoggedLightweightCoachSession,
} from '@/lib/copilot/server';
import { createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import type {
    ChallengeRegenerationInput,
    ChallengeRegenerationResult,
    ChatResponseInput,
    ChatResponseResult,
    GoalRegenerationInput,
    GoalRegenerationResult,
    TopicRegenerationInput,
    TopicRegenerationResult,
} from '@/lib/jobs';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { readStorage, writeStorage } from '@/lib/storage/utils';
import type { Message, Thread } from '@/lib/threads';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { extractJSON } from '@/lib/utils/json-utils';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Jobs API');

// =============================================================================
// Session Tracking for Cancellation
// =============================================================================

/** 
 * Minimal Map of running sessions - ONLY stores the destroy function.
 * Job metadata stays in jobStorage (single source of truth).
 */
const runningSessions = new Map<string, { destroy: () => Promise<void> }>();

/** Register a session for potential cancellation */
function registerSession(jobId: string, session: { destroy: () => Promise<void> }): void {
  runningSessions.set(jobId, session);
  log.debug(`[Job ${jobId}] Session registered for cancellation`);
}

/** Unregister a session (call when job completes) */
function unregisterSession(jobId: string): void {
  runningSessions.delete(jobId);
}

/** 
 * Check if job is still valid (exists and not cancelled).
 * Returns false if job should stop.
 */
async function isJobStillValid(jobId: string): Promise<boolean> {
  jobStorage.invalidateCache();
  const job = await jobStorage.get(jobId);
  if (!job) {
    log.info(`[Job ${jobId}] Job no longer exists in storage - stopping`);
    return false;
  }
  if (job.status === 'cancelled') {
    log.info(`[Job ${jobId}] Job marked as cancelled - stopping`);
    return false;
  }
  return true;
}

/** 
 * Cancel a running job by ID.
 * Marks as cancelled in storage and destroys session if available.
 */
export async function cancelRunningJob(jobId: string): Promise<boolean> {
  // First mark as cancelled in storage (source of truth)
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
  
  // Then destroy session if we have a reference
  const session = runningSessions.get(jobId);
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

// Thread storage schema for direct server-side access
interface ThreadsStorageSchema {
  threads: Thread[];
}

const DEFAULT_THREADS_SCHEMA: ThreadsStorageSchema = { threads: [] };

function validateThreadsSchema(data: unknown): data is ThreadsStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return Array.isArray(schema.threads);
}

/** Read threads directly from storage (server-side) */
async function readThreadsStorage(): Promise<Thread[]> {
  const storage = await readStorage<ThreadsStorageSchema>(
    'threads.json',
    DEFAULT_THREADS_SCHEMA,
    validateThreadsSchema
  );
  return storage.threads;
}

/** Write threads directly to storage (server-side) */
async function writeThreadsStorage(threads: Thread[]): Promise<void> {
  await writeStorage('threads.json', { threads });
}

/** Get a thread by ID directly from storage (server-side) */
async function getThreadById(threadId: string): Promise<Thread | null> {
  const threads = await readThreadsStorage();
  return threads.find(t => t.id === threadId) ?? null;
}

/** Update a thread directly in storage (server-side) */
async function updateThread(updatedThread: Thread): Promise<void> {
  const threads = await readThreadsStorage();
  const index = threads.findIndex(t => t.id === updatedThread.id);
  if (index >= 0) {
    threads[index] = { ...updatedThread, updatedAt: now() };
  } else {
    threads.unshift(updatedThread);
  }
  await writeThreadsStorage(threads);
}

interface CreateJobRequest {
  type: 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'chat-response';
  targetId?: string;
  input: TopicRegenerationInput | ChallengeRegenerationInput | GoalRegenerationInput | ChatResponseInput;
}

/**
 * Execute a topic regeneration job.
 * This runs async - the job is marked running, then completed/failed.
 */
async function executeTopicRegeneration(
  jobId: string,
  input: TopicRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    // Check if job is still valid (not cancelled)
    if (!await isJobStillValid(jobId)) {
      return;
    }
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Check again after context build
    if (!await isJobStillValid(jobId)) {
      return;
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
    
    // Register session for potential cancellation
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    // Unregister session now that AI call is complete
    unregisterSession(jobId);
    
    // Check if cancelled during AI call
    if (!await isJobStillValid(jobId)) {
      await loggedSession.destroy();
      return;
    }
    
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
    await jobStorage.markCompleted<TopicRegenerationResult>(jobId, {
      learningTopic: parsed.learningTopic,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a challenge regeneration job.
 */
async function executeChallengeRegeneration(
  jobId: string,
  input: ChallengeRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    // Check if job is still valid (not cancelled)
    if (!await isJobStillValid(jobId)) {
      return;
    }
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Check again after context build
    if (!await isJobStillValid(jobId)) {
      return;
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
    
    // Register session for potential cancellation
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending challenge prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    // Unregister session now that AI call is complete
    unregisterSession(jobId);
    
    // Check if cancelled during AI call
    if (!await isJobStillValid(jobId)) {
      await loggedSession.destroy();
      return;
    }
    
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
    await jobStorage.markCompleted<ChallengeRegenerationResult>(jobId, {
      challenge: parsed.challenge,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a goal regeneration job.
 */
async function executeGoalRegeneration(
  jobId: string,
  input: GoalRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    // Check if job is still valid (not cancelled)
    if (!await isJobStillValid(jobId)) {
      return;
    }
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    // Check again after context build
    if (!await isJobStillValid(jobId)) {
      return;
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
    
    // Register session for potential cancellation
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending goal prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    // Unregister session now that AI call is complete
    unregisterSession(jobId);
    
    // Check if cancelled during AI call
    if (!await isJobStillValid(jobId)) {
      await loggedSession.destroy();
      return;
    }
    
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
    await jobStorage.markCompleted<GoalRegenerationResult>(jobId, {
      goal: parsed.goal,
    });
    
    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a chat response job.
 * Generates AI response and saves it incrementally to thread storage.
 */
async function executeChatResponse(
  jobId: string,
  input: ChatResponseInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  const { threadId, prompt, learningMode = false, useGitHubTools = false } = input;
  
  try {
    log.info(`[Job ${jobId}] Starting chat response for thread ${threadId}`);
    
    // Get the thread to add messages to (using direct storage access)
    const thread = await getThreadById(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    
    // Create the appropriate streaming session
    // Note: The 3rd param is operationName (for logging), 4th is conversationId
    const session = learningMode
      ? await createLearningStreamingSession(prompt, useGitHubTools, `Job: ${jobId}`, threadId)
      : await createStreamingChatSession(prompt, useGitHubTools, `Job: ${jobId}`, threadId);
    
    let fullContent = '';
    const toolCalls: string[] = [];
    let hasActionableItem = false;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 500; // Save every 500ms during streaming
    
    // Helper to save current progress to thread (using direct storage access)
    // NOTE: If SSE already saved a response, we don't want to duplicate
    const saveProgressToThread = async (isFinal: boolean) => {
      try {
        const currentThread = await getThreadById(threadId);
        if (!currentThread) return;
        
        // Find the user message we're responding to (should be the one with our prompt)
        const userMessageIndex = currentThread.messages.findIndex(
          m => m.role === 'user' && m.content === prompt
        );
        
        if (userMessageIndex === -1) {
          log.warn(`[Job ${jobId}] Could not find user message with prompt, skipping save`);
          return;
        }
        
        // Check if there are any assistant responses AFTER the user message that aren't from this job
        const responseAfterUser = currentThread.messages.slice(userMessageIndex + 1).find(
          m => m.role === 'assistant'
        );
        
        // If SSE already saved a complete response (has content, not from our streaming ID, no cursor)
        if (responseAfterUser && 
            !responseAfterUser.id.startsWith('streaming-') &&
            !responseAfterUser.content?.includes(' ▊') &&
            responseAfterUser.content && responseAfterUser.content.length > 100) {
          // SSE already saved a complete response, skip saving from background job
          log.debug(`[Job ${jobId}] SSE already saved response (${responseAfterUser.content.length} chars), skipping background save`);
          return;
        }
        
        // Find or create our streaming message
        const existingIndex = currentThread.messages.findIndex(m => m.id === `streaming-${jobId}`);
        
        const streamingMessage: Message = {
          id: isFinal ? generateMessageId() : `streaming-${jobId}`,
          role: 'assistant',
          content: fullContent + (isFinal ? '' : ' ▊'), // Add cursor if still streaming
          timestamp: now(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          hasActionableItem,
        };
        
        let updatedMessages: Message[];
        if (existingIndex >= 0) {
          // Update our existing streaming message
          updatedMessages = [...currentThread.messages];
          updatedMessages[existingIndex] = streamingMessage;
        } else if (isFinal) {
          // Only add a new message if this is the final save and there's no complete response yet
          // Insert right after the user message
          updatedMessages = [
            ...currentThread.messages.slice(0, userMessageIndex + 1),
            streamingMessage,
            ...currentThread.messages.slice(userMessageIndex + 1)
          ];
        } else {
          // Skip adding new streaming messages - SSE handles real-time updates
          log.debug(`[Job ${jobId}] Skipping non-final save, SSE handles real-time updates`);
          return;
        }
        
        await updateThread({
          ...currentThread,
          messages: updatedMessages,
          updatedAt: now(),
        });
        
        log.debug(`[Job ${jobId}] Saved progress: ${fullContent.length} chars, final=${isFinal}`);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to save progress:`, err);
      }
    };
    
    // Process the stream (stream is an AsyncGenerator, not a function)
    for await (const event of session.stream) {
      if (event.type === 'delta') {
        fullContent += event.content;
        
        // Save periodically during streaming
        const nowMs = Date.now();
        if (nowMs - lastSaveTime >= SAVE_INTERVAL_MS) {
          await saveProgressToThread(false);
          lastSaveTime = nowMs;
        }
      } else if (event.type === 'tool_start') {
        toolCalls.push(event.name);
      } else if (event.type === 'done') {
        // Detect actionable content
        hasActionableItem = detectActionableContent(fullContent);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
    
    // Cleanup the session
    session.cleanup();
    
    // Final save
    await saveProgressToThread(true);
    
    // Mark job completed
    await jobStorage.markCompleted<ChatResponseResult>(jobId, {
      threadId,
      content: fullContent,
      hasActionableItem,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
    
    log.info(`[Job ${jobId}] Chat response completed: ${fullContent.length} chars`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Chat response failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
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
  const job = await jobStorage.create({
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
  } else if (body.type === 'chat-response') {
    setImmediate(() => {
      executeChatResponse(jobId, body.input as ChatResponseInput).catch(err => {
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
  
  // Invalidate cache to get fresh data from disk
  jobStorage.invalidateCache();
  let jobs = type ? await jobStorage.getByType(type) : await jobStorage.getAll();
  
  if (status) {
    jobs = jobs.filter(job => job.status === status);
  }
  
  return NextResponse.json({ jobs });
}
