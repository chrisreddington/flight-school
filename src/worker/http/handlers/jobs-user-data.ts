/** Handlers for `/api/internal/jobs/user-data` — GET (export) and DELETE (purge). */

import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { requestCancellation } from '@/worker/jobs/executors/session-registry';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';

const log = logger.withTag('InternalJobsUserData');

export async function handleJobsUserDataGet(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });
  const jobs = await jobStorage.getAll();
  const owned = jobs.filter((job) => job.userId === userId);
  return Response.json({ jobs: owned });
}

export async function handleJobsUserDataDelete(request: Request): Promise<Response> {
  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

  const allJobs = await jobStorage.getAll();
  const ownedRunning = allJobs.filter((j) => j.userId === userId && (j.status === 'running' || j.status === 'pending'));
  let cancelled = 0;
  for (const job of ownedRunning) {
    try {
      const cas = await jobStorage.markCancelledIfNonTerminal(job.id);
      if (!cas.transitioned) continue;
      let hadActiveSession = false;
      try {
        hadActiveSession = await requestCancellation(job.id);
      } catch (err) {
        log.warn(`[user ${userId}] requestCancellation threw for job ${job.id}`, err);
      }
      if (!hadActiveSession) {
        try {
          jobEventBus.appendTerminalIfNotTerminated(job.id, {
            type: 'cancelled',
            content: '',
            toolEvents: [],
          });
        } catch (err) {
          log.warn(`[user ${userId}] Failed to emit orphan cancelled for job ${job.id}`, err);
        }
      }
      cancelled += 1;
    } catch (err) {
      log.warn(`[user ${userId}] cancel failed for job ${job.id}`, err);
    }
  }

  const { deleted } = await jobStorage.deleteForUser(userId);
  return Response.json({ deleted, cancelled });
}
