import { jobStorage } from '@/lib/jobs';
import { readEvaluationStorage, writeEvaluationStorage } from '@/lib/jobs/storage/evaluation-storage';
import { logger } from '@/lib/logger';
import { now } from '@/lib/utils/date-utils';

const log = logger.withTag('JobProgress');

/**
 * Update the polling-visible `currentStep` for an in-flight evaluation job.
 *
 * Writes to both the job record and, for challenge evaluations, to evaluation
 * progress so the sandbox poller sees step narration without a second fetch.
 */
export async function reportStep(jobId: string, userId: string, step: string, challengeId?: string): Promise<void> {
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
 * Mirror credentials failures into evaluation storage so the sandbox poller can
 * surface the structured error code and re-authentication CTA.
 */
export async function mirrorCredentialsFailureToEvaluation(
  jobId: string,
  userId: string,
  errorCode: 'credentials_missing' | 'credentials_refresh_failed',
): Promise<void> {
  try {
    const job = await jobStorage.get(jobId);
    if (!job || job.type !== 'challenge-evaluation') return;
    const challengeId =
      typeof job.targetId === 'string' ? job.targetId : (job.input as { challengeId?: string }).challengeId;
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
