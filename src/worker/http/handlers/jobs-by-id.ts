/** Handlers for `/api/internal/jobs/:id` — get (GET) and cancel (DELETE). */

import { jobStorage } from '@/lib/jobs';
import { redactJobForDetail } from '@/lib/jobs/redact';
import { logger } from '@/lib/logger';
import { requestCancellation } from '@/worker/jobs/executors/session-registry';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';

const log = logger.withTag('InternalJobById');

export async function handleJobGet(request: Request, id: string): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

  jobStorage.invalidateCache();
  const job = await jobStorage.get(id);
  if (!job || job.userId !== userId) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }
  return Response.json(redactJobForDetail(job));
}

export async function handleJobDelete(request: Request, id: string): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) return Response.json({ error: 'userId is required' }, { status: 400 });

  const job = await jobStorage.get(id);
  if (!job || job.userId !== userId) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return Response.json({ alreadyTerminal: true, status: job.status });
  }

  const cas = await jobStorage.markCancelledIfNonTerminal(id);
  if (!cas.transitioned) {
    return Response.json({ alreadyTerminal: true, status: cas.status });
  }
  let hadActiveSession = false;
  try {
    hadActiveSession = await requestCancellation(id);
  } catch (err) {
    log.warn(`[Job ${id}] requestCancellation threw after markCancelled`, err);
  }
  if (!hadActiveSession) {
    try {
      jobEventBus.appendTerminalIfNotTerminated(id, {
        type: 'cancelled',
        content: '',
        toolEvents: [],
      });
    } catch (err) {
      log.warn(`[Job ${id}] Failed to emit orphan cancelled to bus`, err);
    }
  }

  return Response.json({ cancelled: true, orphan: !hadActiveSession });
}
