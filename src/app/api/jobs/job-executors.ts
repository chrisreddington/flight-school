/**
 * Job Executors
 * 
 * Async execution functions for background AI jobs.
 * Each executor runs the AI operation and updates job status in storage.
 */

import {
  buildSingleChallengePrompt,
  buildSingleGoalPrompt,
  buildSingleTopicPrompt,
} from '@/lib/copilot/prompts';
import { createLoggedLightweightCoachSession } from '@/lib/copilot/server';
import { createEvaluationStreamingSession, createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import {
  buildEvaluationPrompt,
  EVALUATION_SYSTEM_PROMPT,
  extractStreamingFeedback,
  parseEvaluationResponse,
  parsePartialEvaluation,
} from '@/lib/copilot/evaluation';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import type {
  ChallengeEvaluationInput,
  ChallengeEvaluationResult,
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
import type { Message } from '@/lib/threads';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { extractJSON } from '@/lib/utils/json-utils';
import { getThreadById, updateThread } from './threads-storage';
import { readEvaluationStorage, writeEvaluationStorage } from './evaluation-storage';

const log = logger.withTag('JobExecutors');

/** Map of running sessions for cancellation support */
const runningSessions = new Map<string, { destroy: () => Promise<void> }>();

/** Register a session for potential cancellation */
export function registerSession(jobId: string, session: { destroy: () => Promise<void> }): void {
  runningSessions.set(jobId, session);
  log.debug(`[Job ${jobId}] Session registered for cancellation`);
}

/** Unregister a session (call when job completes) */
export function unregisterSession(jobId: string): void {
  runningSessions.delete(jobId);
}

/** Get a registered session for cancellation */
export function getRegisteredSession(jobId: string): { destroy: () => Promise<void> } | undefined {
  return runningSessions.get(jobId);
}

/** Check if job is still valid (exists and not cancelled). */
export async function isJobStillValid(jobId: string): Promise<boolean> {
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
 * Execute a topic regeneration job.
 */
export async function executeTopicRegeneration(
  jobId: string,
  input: TopicRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    if (!await isJobStillValid(jobId)) return;
    
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
    
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    unregisterSession(jobId);
    
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
    
    if (!parsed.learningTopic.id) {
      parsed.learningTopic.id = crypto.randomUUID();
    }
    
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
export async function executeChallengeRegeneration(
  jobId: string,
  input: ChallengeRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    if (!await isJobStillValid(jobId)) return;
    
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
    
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending challenge prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    unregisterSession(jobId);
    
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
    
    if (!parsed.challenge.id) {
      parsed.challenge.id = crypto.randomUUID();
    }
    
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
export async function executeGoalRegeneration(
  jobId: string,
  input: GoalRegenerationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;
    
    // Build context
    let serializedContext = '';
    try {
      const compactProfile = await buildCompactContext(1000);
      serializedContext = serializeContext(compactProfile);
    } catch (err) {
      log.warn('Failed to build context:', err);
    }
    
    if (!await isJobStillValid(jobId)) return;
    
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
    
    registerSession(jobId, loggedSession);
    
    log.info(`[Job ${jobId}] Sending goal prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);
    
    unregisterSession(jobId);
    
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
    
    if (!parsed.goal.id) {
      parsed.goal.id = crypto.randomUUID();
    }
    
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
export async function executeChatResponse(
  jobId: string,
  input: ChatResponseInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  const { threadId, prompt, learningMode = false, useGitHubTools = false, repos } = input;
  
  try {
    log.info(`[Job ${jobId}] Starting chat response for thread ${threadId}`);
    
    const thread = await getThreadById(threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    
    // Build repository context if repos are provided
    let contextualPrompt = prompt;
    if (repos && repos.length > 0 && useGitHubTools) {
      const repoList = repos.map(r => `- ${r}`).join('\n');
      const repoContext = `Context: Focus on these repositories when using GitHub tools:\n${repoList}\n\n`;
      contextualPrompt = repoContext + prompt;
      log.debug(`[Job ${jobId}] Added repository context for ${repos.length} repos`);
    }
    
    // Create the appropriate streaming session
    const session = learningMode
      ? await createLearningStreamingSession(contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId)
      : await createStreamingChatSession(contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId);
    
    registerSession(jobId, { 
      destroy: async () => {
        log.debug(`[Job ${jobId}] Destroying session via registered callback`);
        session.cleanup();
      }
    });
    
    let fullContent = '';
    const toolCalls: string[] = [];
    let hasActionableItem = false;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 400;
    
    // Helper to save current progress to thread
    const saveProgressToThread = async (isFinal: boolean) => {
      try {
        const currentThread = await getThreadById(threadId);
        if (!currentThread) return;
        
        const userMessageIndex = currentThread.messages.findIndex(
          m => m.role === 'user' && m.content === prompt
        );
        
        if (userMessageIndex === -1) {
          log.warn(`[Job ${jobId}] Could not find user message with prompt, skipping save`);
          return;
        }
        
        const existingIndex = currentThread.messages.findIndex(m => m.id === `streaming-${jobId}`);
        
        const streamingMessage: Message = {
          id: isFinal ? generateMessageId() : `streaming-${jobId}`,
          role: 'assistant',
          content: fullContent + (isFinal ? '' : ' ▊'),
          timestamp: now(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          hasActionableItem,
        };
        
        let updatedMessages: Message[];
        if (existingIndex >= 0) {
          updatedMessages = [...currentThread.messages];
          updatedMessages[existingIndex] = streamingMessage;
        } else {
          updatedMessages = [
            ...currentThread.messages.slice(0, userMessageIndex + 1),
            streamingMessage,
            ...currentThread.messages.slice(userMessageIndex + 1)
          ];
        }
        
        await updateThread({
          ...currentThread,
          messages: updatedMessages,
          updatedAt: now(),
          isStreaming: !isFinal,
        });
        
        log.debug(`[Job ${jobId}] Saved progress: ${fullContent.length} chars, final=${isFinal}`);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to save progress:`, err);
      }
    };

    let wasCancelled = false;
    for await (const event of session.stream) {
      if (!(await isJobStillValid(jobId))) {
        log.info(`[Job ${jobId}] Job cancelled - breaking out of stream loop`);
        wasCancelled = true;
        break;
      }
      
      if (event.type === 'delta') {
        fullContent += event.content;
        
        const nowMs = Date.now();
        if (nowMs - lastSaveTime >= SAVE_INTERVAL_MS) {
          await saveProgressToThread(false);
          lastSaveTime = nowMs;
        }
      } else if (event.type === 'tool_start') {
        toolCalls.push(event.name);
      } else if (event.type === 'done') {
        hasActionableItem = detectActionableContent(fullContent);
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
    
    session.cleanup();
    unregisterSession(jobId);
    
    if (wasCancelled) {
      log.info(`[Job ${jobId}] Chat response cancelled after ${fullContent.length} chars`);
      return;
    }
    
    await saveProgressToThread(true);
    
    await jobStorage.markCompleted<ChatResponseResult>(jobId, {
      threadId,
      content: fullContent,
      hasActionableItem,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
    
    log.info(`[Job ${jobId}] Chat response completed: ${fullContent.length} chars`);
  } catch (error) {
    unregisterSession(jobId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Chat response failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a challenge evaluation job.
 * Evaluates solution and saves progress incrementally to evaluation storage.
 */
export async function executeChallengeEvaluation(
  jobId: string,
  input: ChallengeEvaluationInput
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  const { challengeId, challenge, files } = input;
  
  try {
    log.info(`[Job ${jobId}] Starting evaluation for challenge ${challengeId}`);
    
    // Initialize evaluation progress
    await writeEvaluationStorage({
      evaluations: {
        [challengeId]: {
          challengeId,
          jobId,
          status: 'pending',
          streamingFeedback: '',
          updatedAt: now(),
        },
      },
      version: 1,
    });
    
    // Build the evaluation prompt
    const prompt = buildEvaluationPrompt(
      {
        title: challenge.title,
        description: challenge.description,
        language: challenge.language,
        difficulty: challenge.difficulty as 'beginner' | 'intermediate' | 'advanced',
        testCases: challenge.testCases ? JSON.parse(challenge.testCases) : undefined,
      },
      files
    );
    
    // Create streaming session
    const { stream, cleanup } = await createEvaluationStreamingSession(
      prompt,
      EVALUATION_SYSTEM_PROMPT,
      `Job: ${jobId}`
    );
    
    registerSession(jobId, { destroy: async () => cleanup() });
    
    let fullContent = '';
    let sentPartial = false;
    let lastFeedbackLength = 0;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 300;
    
    // Helper to save progress
    const saveProgress = async (isFinal: boolean = false) => {
      const storage = await readEvaluationStorage();
      const currentProgress = storage.evaluations[challengeId] || {
        challengeId,
        jobId,
        status: 'streaming',
        streamingFeedback: '',
        updatedAt: now(),
      };
      
      // Parse partial if not yet sent
      if (!sentPartial) {
        const partial = parsePartialEvaluation(fullContent);
        if (partial) {
          sentPartial = true;
          currentProgress.partial = partial;
        }
      }
      
      // Extract streaming feedback
      if (sentPartial) {
        const currentFeedback = extractStreamingFeedback(fullContent);
        if (currentFeedback.length > lastFeedbackLength) {
          currentProgress.streamingFeedback = currentFeedback;
          lastFeedbackLength = currentFeedback.length;
        }
      }
      
      currentProgress.status = isFinal ? 'completed' : 'streaming';
      currentProgress.updatedAt = now();
      
      if (isFinal) {
        const evaluationResult = parseEvaluationResponse(fullContent);
        if (evaluationResult) {
          currentProgress.result = evaluationResult;
        } else {
          currentProgress.result = {
            isCorrect: false,
            feedback: fullContent || 'Unable to parse evaluation.',
            strengths: [],
            improvements: ['Please try submitting again.'],
          };
        }
      }
      
      storage.evaluations[challengeId] = currentProgress;
      await writeEvaluationStorage(storage);
    };
    
    let wasCancelled = false;
    for await (const event of stream) {
      if (!(await isJobStillValid(jobId))) {
        log.info(`[Job ${jobId}] Job cancelled - breaking out of stream loop`);
        wasCancelled = true;
        break;
      }
      
      if (event.type === 'delta') {
        fullContent += event.content;
        
        const nowMs = Date.now();
        if (nowMs - lastSaveTime >= SAVE_INTERVAL_MS) {
          await saveProgress(false);
          lastSaveTime = nowMs;
        }
      }
      
      if (event.type === 'done') {
        fullContent = event.totalContent;
      }
    }
    
    cleanup();
    unregisterSession(jobId);
    
    if (wasCancelled) {
      log.info(`[Job ${jobId}] Evaluation cancelled`);
      return;
    }
    
    // Save final result
    await saveProgress(true);
    
    // Mark job completed
    const storage = await readEvaluationStorage();
    const finalProgress = storage.evaluations[challengeId];
    
    await jobStorage.markCompleted<ChallengeEvaluationResult>(jobId, {
      challengeId,
      isCorrect: finalProgress?.result?.isCorrect ?? false,
      feedback: finalProgress?.result?.feedback ?? '',
      strengths: finalProgress?.result?.strengths ?? [],
      improvements: finalProgress?.result?.improvements ?? [],
      score: finalProgress?.result?.score,
      nextSteps: finalProgress?.result?.nextSteps,
      streamingFeedback: finalProgress?.streamingFeedback,
      partial: finalProgress?.partial,
    });
    
    log.info(`[Job ${jobId}] Evaluation completed: isCorrect=${finalProgress?.result?.isCorrect}`);
  } catch (error) {
    unregisterSession(jobId);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Evaluation failed:`, errorMessage);
    
    // Update storage with error
    const storage = await readEvaluationStorage();
    storage.evaluations[challengeId] = {
      challengeId,
      jobId,
      status: 'failed',
      streamingFeedback: '',
      error: errorMessage,
      updatedAt: now(),
    };
    await writeEvaluationStorage(storage);
    
    await jobStorage.markFailed(jobId, errorMessage);
  }
}
