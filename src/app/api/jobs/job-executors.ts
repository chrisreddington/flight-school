/**
 * Job Executors
 * 
 * Async execution functions for background AI jobs.
 * Each executor runs the AI operation and updates job status in storage.
 */

import { resolveFreshGitHubToken } from '@/lib/auth/token-resolver';
import {
  buildSingleChallengePrompt,
  buildSingleGoalPrompt,
  buildSingleTopicPrompt,
} from '@/lib/copilot/prompts';
import { createLoggedLightweightCoachSession, type SessionIdentity } from '@/lib/copilot/server';
import { createEvaluationStreamingSession, createLearningStreamingSession, createStreamingChatSession } from '@/lib/copilot/streaming';
import {
  buildEvaluationPrompt,
  EVALUATION_SYSTEM_PROMPT,
  extractStreamingFeedback,
  parseEvaluationResponse,
  parsePartialEvaluation,
} from '@/lib/copilot/evaluation';
import { getOctokitForToken } from '@/lib/github/client';
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
import { auditLog, hashUserId } from '@/lib/security/audit';
import type { Message, ToolCallEvent } from '@/lib/threads';
import { detectActionableContent } from '@/lib/utils/content-detection';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { extractJSON } from '@/lib/utils/json-utils';
import { getThreadById, updateThread } from './threads-storage';
import { readEvaluationStorage, writeEvaluationStorage } from './evaluation-storage';
import { deleteScratchpad, readScratchpad, writeScratchpad } from '@/lib/storage/scratchpad';

const log = logger.withTag('JobExecutors');

/**
 * Resolve a fresh {@link SessionIdentity} for a job at execution time.
 *
 * Background jobs persist `userId` only — never the access token captured
 * at submission. This helper looks up the latest `ghu_` token from the
 * {@link TokenStore} (refreshing if necessary) so the executor always
 * acts on behalf of the user with a non-expired credential, even when the
 * job has been queued for hours.
 *
 * @returns The identity to pass to Copilot SDK / Octokit factories, or
 *   `null` after the helper has already audit-logged the failure and
 *   marked `jobId` as `failed` in storage. Callers MUST bail when this
 *   returns `null`.
 */
async function resolveJobIdentity(jobId: string, userId: string): Promise<SessionIdentity | null> {
  try {
    const token = await resolveFreshGitHubToken(userId);
    if (!token) {
      log.warn(`[Job ${jobId}] No stored credentials for user; failing job`);
      auditLog({
        type: 'job.credentials_missing',
        userIdHash: hashUserId(userId),
        metadata: { jobId },
      });
      await jobStorage.markFailed(
        jobId,
        'GitHub credentials missing — user must re-authenticate.',
        'credentials_missing',
      );
      await mirrorCredentialsFailureToEvaluation(jobId, userId, 'credentials_missing');
      return null;
    }
    return { userId, gitHubToken: token };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown refresh error';
    log.error(`[Job ${jobId}] Token refresh failed:`, message);
    auditLog({
      type: 'job.credentials_refresh_failed',
      userIdHash: hashUserId(userId),
      metadata: { jobId, error: message },
    });
    await jobStorage.markFailed(
      jobId,
      'GitHub credentials expired — user must re-authenticate.',
      'credentials_refresh_failed',
    );
    await mirrorCredentialsFailureToEvaluation(jobId, userId, 'credentials_refresh_failed');
    return null;
  }
}

/**
 * Update the polling-visible `currentStep` for an in-flight evaluation job.
 *
 * Writes to both the job record (visible via `/api/jobs/[id]`) and, when the
 * job is a challenge evaluation, to the evaluation progress record (visible
 * via `/api/evaluations/[challengeId]`) so the existing sandbox polling
 * client picks up step narration without a second fetch.
 */
async function reportStep(jobId: string, userId: string, step: string, challengeId?: string): Promise<void> {
  try {
    await jobStorage.setCurrentStep(jobId, step);
    if (challengeId) {
      const storage = await readEvaluationStorage(userId);
      const existing = storage.evaluations[challengeId];
      if (existing) {
        existing.currentStep = step;
        existing.updatedAt = now();
        storage.evaluations[challengeId] = existing;
        await writeEvaluationStorage(userId, storage);
      }
    }
  } catch (err) {
    log.debug(`[Job ${jobId}] Failed to report step "${step}":`, err);
  }
}

/**
 * Mirror credentials failures into the evaluation storage so the sandbox's
 * evaluation poller surfaces the structured errorCode (and re-auth CTA)
 * without needing a separate /api/jobs/[id] lookup.
 */
async function mirrorCredentialsFailureToEvaluation(
  jobId: string,
  userId: string,
  errorCode: 'credentials_missing' | 'credentials_refresh_failed',
): Promise<void> {
  try {
    const job = await jobStorage.get(jobId);
    if (!job || job.type !== 'challenge-evaluation') return;
    const challengeId =
      typeof job.targetId === 'string'
        ? job.targetId
        : (job.input as { challengeId?: string }).challengeId;
    if (!challengeId) return;
    const storage = await readEvaluationStorage(userId);
    const previous = storage.evaluations[challengeId];
    storage.evaluations[challengeId] = {
      ...(previous ?? {
        challengeId,
        jobId,
        streamingFeedback: '',
      }),
      challengeId,
      jobId,
      status: 'failed',
      streamingFeedback: previous?.streamingFeedback ?? '',
      error: job.error,
      errorCode,
      updatedAt: now(),
    };
    await writeEvaluationStorage(userId, storage);
  } catch (err) {
    log.debug(`[Job ${jobId}] Failed to mirror credentials failure:`, err);
  }
}

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
  input: TopicRegenerationInput,
  userId: string
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;
    
    // Build context
    let serializedContext = '';
    try {
      const octokit = getOctokitForToken(identity.gitHubToken);
      const compactProfile = await buildCompactContext(octokit, 1000);
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
      identity,
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
  input: ChallengeRegenerationInput,
  userId: string
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;
    
    // Build context
    let serializedContext = '';
    try {
      const octokit = getOctokitForToken(identity.gitHubToken);
      const compactProfile = await buildCompactContext(octokit, 1000);
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
      identity,
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
  input: GoalRegenerationInput,
  userId: string
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  try {
    if (!await isJobStillValid(jobId)) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;
    
    // Build context
    let serializedContext = '';
    try {
      const octokit = getOctokitForToken(identity.gitHubToken);
      const compactProfile = await buildCompactContext(octokit, 1000);
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
      identity,
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
 * Best-effort: read the per-job scratchpad from disk and merge it into
 * `users/{userId}/threads.json` as a finalised assistant message,
 * then delete the scratchpad. Used by both the happy-path
 * consolidation and the catch-block fallback (where the in-memory
 * stream state isn't reachable).
 *
 * Upserts by `assistantMessageId`, so re-running is idempotent.
 * Silently no-ops when there's no scratchpad (e.g. the executor
 * crashed before the first delta).
 */
async function consolidateScratchpadToThread(
  userId: string,
  jobId: string,
  isFinal: boolean,
): Promise<void> {
  const scratchpad = await readScratchpad(userId, jobId);
  if (!scratchpad) return;
  const { threadId, assistantMessageId, content, toolEvents, hasActionableItem } = scratchpad;

  const currentThread = await getThreadById(userId, threadId);
  if (!currentThread) {
    // Thread was deleted while the job was running — drop the scratchpad.
    await deleteScratchpad(userId, jobId);
    return;
  }

  const consolidatedMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: content + (isFinal ? '' : ' ▊'),
    timestamp: now(),
    toolEvents: toolEvents && toolEvents.length > 0 ? toolEvents.map((e) => ({ ...e })) : undefined,
    hasActionableItem,
  };

  const existingIndex = currentThread.messages.findIndex((m) => m.id === assistantMessageId);
  let updatedMessages: Message[];
  if (existingIndex >= 0) {
    updatedMessages = [...currentThread.messages];
    updatedMessages[existingIndex] = {
      ...updatedMessages[existingIndex],
      ...consolidatedMessage,
    };
  } else {
    updatedMessages = [...currentThread.messages, consolidatedMessage];
  }

  await updateThread(userId, {
    ...currentThread,
    messages: updatedMessages,
    updatedAt: now(),
    isStreaming: !isFinal,
  });

  await deleteScratchpad(userId, jobId);
}

/**
 * Execute a chat response job.
 * Generates AI response and saves it incrementally to thread storage.
 */
export async function executeChatResponse(
  jobId: string,
  input: ChatResponseInput,
  userId: string
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  const { threadId, prompt, assistantMessageId: providedAssistantId, learningMode = false, useGitHubTools = false, repos } = input;
  // Server route is responsible for validating + populating
  // assistantMessageId on chat-response jobs. Fall back here only as a
  // defensive guard for any old in-flight job that predates Phase D.
  const assistantMessageId = providedAssistantId ?? generateMessageId();
  
  try {
    log.info(`[Job ${jobId}] Starting chat response for thread ${threadId}`);

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;
    
    const thread = await getThreadById(userId, threadId);
    if (!thread) {
      throw new Error(`Thread ${threadId} not found`);
    }
    
    // Build repository context if repos are provided
    let contextualPrompt = prompt;
    if (repos && repos.length > 0 && useGitHubTools) {
      const repoList = repos.map(r => `- ${r}`).join('\n');
      const repoContext = `The user has selected these repositories as context.\nYou MUST use GitHub MCP tools to look up live repository information before answering.\nDo NOT use local shell/filesystem tools or generic web tools.\n\nSelected repositories:\n${repoList}\n\nUser question: `;
      contextualPrompt = repoContext + prompt;
      log.debug(`[Job ${jobId}] Added repository context for ${repos.length} repos`);
    }
    
    // Create the appropriate streaming session
    const session = learningMode
      ? await createLearningStreamingSession(identity, contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId)
      : await createStreamingChatSession(identity, contextualPrompt, useGitHubTools, `Job: ${jobId}`, threadId);
    
    registerSession(jobId, { 
      destroy: async () => {
        log.debug(`[Job ${jobId}] Destroying session via registered callback`);
        session.cleanup();
      }
    });
    
    let fullContent = '';
    const toolCalls: string[] = [];
    const toolEvents: ToolCallEvent[] = [];
    let toolCounter = 0;
    let hasActionableItem = false;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 400;
    
    // Helper to flush the current in-flight state to the per-job
    // scratchpad. Hot path during streaming — rewrites a tiny
    // single-message file instead of the entire threads.json. The
    // threads route hydrates from the scratchpad on read so the UI
    // still sees live deltas (see `hydrateThreadsWithScratchpads`).
    const flushScratchpad = async (status: 'streaming' | 'completed' | 'failed') => {
      try {
        await writeScratchpad(userId, jobId, {
          threadId,
          assistantMessageId,
          content: fullContent,
          toolEvents: toolEvents.length > 0 ? toolEvents.map(e => ({ ...e })) : undefined,
          hasActionableItem,
          status,
        });
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to flush scratchpad:`, err);
      }
    };

    // Consolidate the in-flight stream into the canonical threads.json
    // and clear the scratchpad. Called once on terminal state (final,
    // cancel, or error). Uses `assistantMessageId` as the upsert key
    // so re-running consolidation is idempotent.
    const consolidateToThread = async (isFinal: boolean) => {
      try {
        const currentThread = await getThreadById(userId, threadId);
        if (!currentThread) return;

        const existingIndex = currentThread.messages.findIndex(m => m.id === assistantMessageId);
        const consolidatedMessage: Message = {
          id: assistantMessageId,
          role: 'assistant',
          content: fullContent + (isFinal ? '' : ' ▊'),
          timestamp: now(),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          toolEvents: toolEvents.length > 0 ? toolEvents.map(e => ({ ...e })) : undefined,
          hasActionableItem,
        };

        let updatedMessages: Message[];
        if (existingIndex >= 0) {
          updatedMessages = [...currentThread.messages];
          updatedMessages[existingIndex] = consolidatedMessage;
        } else {
          updatedMessages = [...currentThread.messages, consolidatedMessage];
        }

        await updateThread(userId, {
          ...currentThread,
          messages: updatedMessages,
          updatedAt: now(),
          isStreaming: !isFinal,
        });

        // Scratchpad is now redundant — the canonical store has the
        // final message. Delete it so the retention sweep doesn't
        // have to. If this fails the sweep will clean it within 1h.
        await deleteScratchpad(userId, jobId);

        log.debug(`[Job ${jobId}] Consolidated to thread: ${fullContent.length} chars, final=${isFinal}`);
      } catch (err) {
        log.warn(`[Job ${jobId}] Failed to consolidate to thread:`, err);
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
          await flushScratchpad('streaming');
          lastSaveTime = nowMs;
        }
      } else if (event.type === 'tool_start') {
        toolCalls.push(event.name);
        toolEvents.push({
          id: `tool-${jobId}-${toolCounter++}`,
          name: event.name,
          status: 'running',
          args: event.args,
        });
        // Persist immediately so the UI surfaces the running state without
        // waiting for the next 400ms save tick.
        await flushScratchpad('streaming');
        lastSaveTime = Date.now();
      } else if (event.type === 'tool_complete') {
        // Match the most recent running event by name (SDK has no correlation id).
        for (let i = toolEvents.length - 1; i >= 0; i--) {
          if (toolEvents[i].status === 'running' && toolEvents[i].name === event.name) {
            toolEvents[i] = {
              ...toolEvents[i],
              status: 'complete',
              result: event.result,
              durationMs: event.duration,
            };
            break;
          }
        }
        await flushScratchpad('streaming');
        lastSaveTime = Date.now();
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
      // Consolidate whatever we have so far into the canonical store
      // and remove the scratchpad, otherwise the cancelled message
      // would linger in scratchpad-land until the next retention sweep.
      await consolidateToThread(true);
      return;
    }
    
    await consolidateToThread(true);
    
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
    // Best-effort: read the scratchpad (which holds the latest delta
    // state flushed before we threw) and write whatever we have into
    // the canonical thread so the user sees the truncated reply.
    // Failures here are non-fatal — the retention sweep is the safety
    // net for the orphaned scratchpad.
    try {
      await consolidateScratchpadToThread(userId, jobId, true);
    } catch (consolidationErr) {
      log.warn(`[Job ${jobId}] Failed to consolidate after error:`, consolidationErr);
    }
    await jobStorage.markFailed(jobId, errorMessage);
  }
}

/**
 * Execute a challenge evaluation job.
 * Evaluates solution and saves progress incrementally to evaluation storage.
 */
export async function executeChallengeEvaluation(
  jobId: string,
  input: ChallengeEvaluationInput,
  userId: string
): Promise<void> {
  await jobStorage.markRunning(jobId);
  
  const { challengeId, challenge, files } = input;
  
  try {
    log.info(`[Job ${jobId}] Starting evaluation for challenge ${challengeId}`);

    await reportStep(jobId, userId, 'Preparing context…', challengeId);

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;
    
    // Initialize evaluation progress
    await writeEvaluationStorage(userId, {
      evaluations: {
        [challengeId]: {
          challengeId,
          jobId,
          status: 'pending',
          streamingFeedback: '',
          currentStep: 'Preparing context…',
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
        type: challenge.type,
        brokenCode: challenge.brokenCode,
        language: challenge.language,
        difficulty: challenge.difficulty as 'beginner' | 'intermediate' | 'advanced',
        testCases: challenge.testCases ? JSON.parse(challenge.testCases) : undefined,
      },
      files
    );

    await reportStep(jobId, userId, 'Running tests…', challengeId);
    
    // Create streaming session
    const { stream, cleanup } = await createEvaluationStreamingSession(
      identity,
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
      const storage = await readEvaluationStorage(userId);
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
          // First parseable signal — narrate the analysis phase.
          await reportStep(jobId, userId, 'Analysing results…', challengeId);
          currentProgress.currentStep = 'Analysing results…';
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
      await writeEvaluationStorage(userId, storage);
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

    await reportStep(jobId, userId, 'Generating feedback…', challengeId);
    
    // Save final result
    await saveProgress(true);
    
    // Mark job completed
    const storage = await readEvaluationStorage(userId);
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
    const storage = await readEvaluationStorage(userId);
    storage.evaluations[challengeId] = {
      challengeId,
      jobId,
      status: 'failed',
      streamingFeedback: '',
      error: errorMessage,
      updatedAt: now(),
    };
    await writeEvaluationStorage(userId, storage);
    
    await jobStorage.markFailed(jobId, errorMessage);
  }
}
