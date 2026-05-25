import { buildSingleChallengePrompt, buildSingleGoalPrompt, buildSingleTopicPrompt } from '@/lib/copilot/prompts';
import { createLoggedCoachSession } from '@/lib/copilot/server';
import type { DailyChallenge, DailyGoal, LearningTopic } from '@/lib/focus/types';
import { getOctokitForToken } from '@/lib/github/octokit-factory';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { jobStorage } from '@/lib/jobs';
import type {
  ChallengeRegenerationInput,
  ChallengeRegenerationResult,
  GoalRegenerationInput,
  GoalRegenerationResult,
  TopicRegenerationInput,
  TopicRegenerationResult,
} from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { isJobStillValid, resolveJobIdentity } from './job-identity';
import { parseRegenerationResponse } from './parse-regeneration';
import { registerSession, unregisterSession } from './session-registry';

const log = logger.withTag('JobRegeneration');

async function buildSerializedContext(gitHubToken: string): Promise<string> {
  try {
    const octokit = getOctokitForToken(gitHubToken);
    const compactProfile = await buildCompactContext(octokit, 1000);
    return serializeContext(compactProfile);
  } catch (err) {
    log.warn('Failed to build context:', err);
    return '';
  }
}

/**
 * Execute a topic regeneration job.
 */
export async function executeTopicRegeneration(
  jobId: string,
  input: TopicRegenerationInput,
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  try {
    if (!(await isJobStillValid(jobId))) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;

    const serializedContext = await buildSerializedContext(identity.gitHubToken);

    if (!(await isJobStillValid(jobId))) return;

    const prompt = buildSingleTopicPrompt(serializedContext, input.existingTopicTitles, input.skillProfile);

    const loggedSession = await createLoggedCoachSession(identity, 'Job: topic-regeneration', prompt.slice(0, 50), []);

    registerSession(jobId, loggedSession);

    log.info(`[Job ${jobId}] Sending prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);

    unregisterSession(jobId);

    if (!(await isJobStillValid(jobId))) {
      await loggedSession.destroy();
      return;
    }

    loggedSession.destroy();

    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);

    const learningTopic = parseRegenerationResponse<{ learningTopic: LearningTopic }, LearningTopic>(
      result.responseText,
      'learningTopic',
      'topic',
    );

    if (!learningTopic.id) {
      learningTopic.id = crypto.randomUUID();
    }

    await jobStorage.markCompleted<TopicRegenerationResult>(jobId, {
      learningTopic,
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
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  try {
    if (!(await isJobStillValid(jobId))) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;

    const serializedContext = await buildSerializedContext(identity.gitHubToken);

    if (!(await isJobStillValid(jobId))) return;

    const prompt = buildSingleChallengePrompt(serializedContext, input.existingChallengeTitles, input.skillProfile);

    const loggedSession = await createLoggedCoachSession(
      identity,
      'Job: challenge-regeneration',
      prompt.slice(0, 50),
      [],
    );

    registerSession(jobId, loggedSession);

    log.info(`[Job ${jobId}] Sending challenge prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);

    unregisterSession(jobId);

    if (!(await isJobStillValid(jobId))) {
      await loggedSession.destroy();
      return;
    }

    loggedSession.destroy();

    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);

    const challenge = parseRegenerationResponse<{ challenge: DailyChallenge }, DailyChallenge>(
      result.responseText,
      'challenge',
      'challenge',
    );

    if (!challenge.id) {
      challenge.id = crypto.randomUUID();
    }

    await jobStorage.markCompleted<ChallengeRegenerationResult>(jobId, {
      challenge,
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
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  try {
    if (!(await isJobStillValid(jobId))) return;

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;

    const serializedContext = await buildSerializedContext(identity.gitHubToken);

    if (!(await isJobStillValid(jobId))) return;

    const prompt = buildSingleGoalPrompt(serializedContext, input.existingGoalTitles, input.skillProfile);

    const loggedSession = await createLoggedCoachSession(identity, 'Job: goal-regeneration', prompt.slice(0, 50), []);

    registerSession(jobId, loggedSession);

    log.info(`[Job ${jobId}] Sending goal prompt (${prompt.length} chars)...`);
    const result = await loggedSession.sendAndWait(prompt);

    unregisterSession(jobId);

    if (!(await isJobStillValid(jobId))) {
      await loggedSession.destroy();
      return;
    }

    loggedSession.destroy();

    log.info(`[Job ${jobId}] Complete: ${result.totalTimeMs}ms`);

    const goal = parseRegenerationResponse<{ goal: DailyGoal }, DailyGoal>(result.responseText, 'goal', 'goal');

    if (!goal.id) {
      goal.id = crypto.randomUUID();
    }

    await jobStorage.markCompleted<GoalRegenerationResult>(jobId, {
      goal,
    });

    log.info(`[Job ${jobId}] Completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error(`[Job ${jobId}] Failed:`, errorMessage);
    await jobStorage.markFailed(jobId, errorMessage);
  }
}
