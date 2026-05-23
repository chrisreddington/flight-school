import {
  buildEvaluationPrompt,
  EVALUATION_SYSTEM_PROMPT,
  extractStreamingFeedback,
  parseEvaluationResponse,
  parsePartialEvaluation,
} from '@/lib/copilot/evaluation';
import { createEvaluationStreamingSession } from '@/lib/copilot/streaming';
import { jobStorage } from '@/lib/jobs';
import type { ChallengeEvaluationInput, ChallengeEvaluationResult } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';
import { readEvaluationStorage, writeEvaluationStorage } from '../evaluation-storage';
import { isJobStillValid, resolveJobIdentity } from './job-identity';
import { reportStep } from './progress';
import { registerSession, unregisterSession } from './session-registry';

const log = logger.withTag('JobEvaluationExecutor');

/**
 * Execute a challenge evaluation job.
 * Evaluates solution and saves progress incrementally to evaluation storage.
 */
export async function executeChallengeEvaluation(
  jobId: string,
  input: ChallengeEvaluationInput,
  userId: string,
): Promise<void> {
  await jobStorage.markRunning(jobId);

  const { challengeId, challenge, files } = input;

  try {
    log.info(`[Job ${jobId}] Starting evaluation for challenge ${challengeId}`);

    await reportStep(jobId, userId, 'Preparing context…', challengeId);

    const identity = await resolveJobIdentity(jobId, userId);
    if (!identity) return;

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
      files,
    );

    await reportStep(jobId, userId, 'Running tests…', challengeId);

    const { stream, cleanup } = await createEvaluationStreamingSession(
      identity,
      prompt,
      EVALUATION_SYSTEM_PROMPT,
      `Job: ${jobId}`,
    );

    registerSession(jobId, { destroy: async () => cleanup() });

    let fullContent = '';
    let sentPartial = false;
    let lastFeedbackLength = 0;
    let lastSaveTime = Date.now();
    const SAVE_INTERVAL_MS = 300;

    const saveProgress = async (isFinal: boolean = false) => {
      const storage = await readEvaluationStorage(userId);
      const currentProgress = storage.evaluations[challengeId] || {
        challengeId,
        jobId,
        status: 'streaming',
        streamingFeedback: '',
        updatedAt: now(),
      };

      if (!sentPartial) {
        const partial = parsePartialEvaluation(fullContent);
        if (partial) {
          sentPartial = true;
          currentProgress.partial = partial;
          await reportStep(jobId, userId, 'Analysing results…', challengeId);
          currentProgress.currentStep = 'Analysing results…';
        }
      }

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

    await saveProgress(true);

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
