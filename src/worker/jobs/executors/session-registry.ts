import { logger } from '@/lib/logger';

const log = logger.withTag('JobSessionRegistry');

const runningSessions = new Map<string, { destroy: () => Promise<void> }>();
const pendingCancellations = new Set<string>();

/** Register a session for potential cancellation. */
export function registerSession(jobId: string, session: { destroy: () => Promise<void> }): void {
  if (pendingCancellations.has(jobId)) {
    pendingCancellations.delete(jobId);
    log.debug(`[Job ${jobId}] Session registered after cancellation request; destroying immediately`);
    void session.destroy().catch((err) => {
      log.warn(`[Job ${jobId}] Failed to destroy session after pending cancellation`, err);
    });
    return;
  }

  runningSessions.set(jobId, session);
  log.debug(`[Job ${jobId}] Session registered for cancellation`);
}

/** Unregister a session when the job completes or fails. */
export function unregisterSession(jobId: string): void {
  runningSessions.delete(jobId);
  pendingCancellations.delete(jobId);
}

/** Get a registered session for cancellation. */
export function getRegisteredSession(jobId: string): { destroy: () => Promise<void> } | undefined {
  return runningSessions.get(jobId);
}

/**
 * Request cancellation for a worker job session.
 *
 * Returns true when an active session was found and a destroy call was made.
 * Returns false when no session is currently registered; a pending marker is
 * stored so any late registration is cancelled immediately.
 */
export async function requestCancellation(jobId: string): Promise<boolean> {
  const session = runningSessions.get(jobId);
  if (!session) {
    pendingCancellations.add(jobId);
    log.debug(`[Job ${jobId}] Cancellation requested before session registration`);
    return false;
  }

  runningSessions.delete(jobId);
  pendingCancellations.delete(jobId);
  await session.destroy();
  return true;
}
