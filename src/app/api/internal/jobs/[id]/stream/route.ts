/**
 * Worker-internal SSE endpoint for streaming job events.
 *
 * GET /api/internal/jobs/[id]/stream?cursor=<seq>
 *
 * Authentication: bearer secret + `x-user-id` header (set by web proxy).
 * The worker validates that the job exists and is owned by the supplied
 * user id before establishing the stream.
 *
 * Only the web proxy at `/api/jobs/[id]/stream` should call this route.
 */

import { jobStorage } from '@/lib/jobs';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { createJobStreamResponse, createSynthesizedTerminalResponse } from '@/worker/jobs/streaming/sse';
import { NextRequest, NextResponse } from 'next/server';

// Streaming SSE connection: hold the route open for the stream lifetime.
export const maxDuration = 300;

interface Params {
  params: Promise<{ id: string }>;
}

async function handleStreamRequest(request: NextRequest, jobId: string) {
  if (process.env.COPILOT_WORKER_MODE !== '1') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'COPILOT_WORKER_SECRET is not configured' }, { status: 500 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = request.headers.get('x-user-id')?.trim();
  if (!userId) {
    return NextResponse.json({ error: 'x-user-id header is required' }, { status: 400 });
  }

  const job = await jobStorage.get(jobId);
  if (!job || job.userId !== userId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
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

  // If the job is known to be terminal AND the event bus has no record
  // of it (buffer swept after retention window), synthesize a terminal
  // SSE frame so a reconnecting client gets a deterministic close
  // instead of hanging on a fresh empty subscription.
  const isJobTerminal =
    job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
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

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  return withExtractedTraceContext(request.headers, async () => handleStreamRequest(request, id));
}
