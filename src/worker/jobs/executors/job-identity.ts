import { resolveFreshGitHubToken } from '@/lib/auth/token-resolver';
import type { SessionIdentity } from '@/lib/copilot/session-identity';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { auditLog, hashUserId } from '@/lib/security/audit';
import { mirrorCredentialsFailureToEvaluation } from './progress';

const log = logger.withTag('JobIdentity');

/**
 * Resolve a fresh {@link SessionIdentity} for a job at execution time.
 *
 * Background jobs persist `userId` only — never the access token captured at
 * submission. This helper looks up the latest token and fails the job when the
 * user must re-authenticate.
 */
export async function resolveJobIdentity(jobId: string, userId: string): Promise<SessionIdentity | null> {
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
