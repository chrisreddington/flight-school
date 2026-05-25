/**
 * Handler for `GET /api/internal/jobs/:id/stream` — SSE.
 *
 * Requires `x-user-id` header (route-group middleware in `app.ts`).
 * Returns the existing `Response` from `createJobStreamResponse`
 * unchanged (per B.6, Hono returns Response objects as-is for SSE).
 */

import { jobStorage } from '@/lib/jobs';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { createJobStreamResponse, createSynthesizedTerminalResponse } from '@/worker/jobs/streaming/sse';

export async function handleJobStream(request: Request, jobId: string, userId: string): Promise<Response> {
  const job = await jobStorage.get(jobId);
  if (!job || job.userId !== userId) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  const urlObj = new URL(request.url);
  const cursorRaw = urlObj.searchParams.get('cursor');
  let afterSeq = 0;
  if (cursorRaw !== null) {
    const parsed = Number.parseInt(cursorRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) afterSeq = parsed;
  }
  const lastEventIdRaw = request.headers.get('last-event-id');
  if (lastEventIdRaw !== null) {
    const parsed = Number.parseInt(lastEventIdRaw, 10);
    if (Number.isFinite(parsed) && parsed > afterSeq) afterSeq = parsed;
  }

  const isJobTerminal = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
  if (isJobTerminal && !jobEventBus.hasBuffer(jobId)) {
    if (job.status === 'completed') {
      return createSynthesizedTerminalResponse({ type: 'done' });
    }
    if (job.status === 'failed') {
      return createSynthesizedTerminalResponse({
        type: 'failed',
        message: job.error ?? 'Job failed',
      });
    }
    return createSynthesizedTerminalResponse({ type: 'cancelled' });
  }

  return createJobStreamResponse(jobId, afterSeq, request.signal);
}
