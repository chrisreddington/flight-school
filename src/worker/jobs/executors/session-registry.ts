import { logger } from '@/lib/logger';

const log = logger.withTag('JobSessionRegistry');

const runningSessions = new Map<string, { destroy: () => Promise<void> }>();

/** Register a session for potential cancellation. */
export function registerSession(jobId: string, session: { destroy: () => Promise<void> }): void {
  runningSessions.set(jobId, session);
  log.debug(`[Job ${jobId}] Session registered for cancellation`);
}

/** Unregister a session when the job completes or fails. */
export function unregisterSession(jobId: string): void {
  runningSessions.delete(jobId);
}

/** Get a registered session for cancellation. */
export function getRegisteredSession(jobId: string): { destroy: () => Promise<void> } | undefined {
  return runningSessions.get(jobId);
}
