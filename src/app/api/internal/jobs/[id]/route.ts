/**
 * Internal worker endpoint for a single job record.
 *
 * `GET /api/internal/jobs/[id]?userId=` — return the redacted job
 * detail DTO scoped to a user. Treats ownership mismatches as 404 to
 * avoid leaking existence across tenants.
 *
 * `DELETE /api/internal/jobs/[id]?userId=` — request in-process
 * cancellation and mark the record cancelled. Does NOT hard-delete;
 * retention sweeps clean the record later.
 */

import { jobStorage } from '@/lib/jobs';
import { redactJobForDetail } from '@/lib/jobs/redact';
import { logger } from '@/lib/logger';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { requestCancellation } from '@/worker/jobs/executors/session-registry';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('InternalJobById');

function authorize(request: NextRequest): NextResponse | null {
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
  return null;
}

async function handleGet(request: NextRequest, id: string) {
  const authError = authorize(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  jobStorage.invalidateCache();
  const job = await jobStorage.get(id);
  if (!job || job.userId !== userId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  return NextResponse.json(redactJobForDetail(job));
}

async function handleDelete(request: NextRequest, id: string) {
  const authError = authorize(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const job = await jobStorage.get(id);
  if (!job || job.userId !== userId) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return NextResponse.json({ alreadyTerminal: true, status: job.status });
  }

  // Phase 5: CAS the job state first so the executor's next
  // `isJobStillValid()` check sees `cancelled`. Then request
  // session cancellation. The boolean tells us whether an active
  // session was found:
  //
  // - `hadActiveSession === true`: the executor is alive and will
  //   reach its terminal sequence shortly, where it calls
  //   `appendTerminalIfNotTerminated(cancelled)` itself. We MUST NOT
  //   emit a competing terminal frame here or the executor's
  //   in-flight annotation work could race the SSE consumer's evict.
  // - `hadActiveSession === false`: the session is gone (worker
  //   crashed, restart, or never registered). The executor will
  //   never emit a terminal frame, so we emit `cancelled` ourselves
  //   to unstick any live SSE consumer. `appendTerminalIfNotTerminated`
  //   is a no-op if a terminal was somehow already written.
  const cas = await jobStorage.markCancelledIfNonTerminal(id);
  if (!cas.transitioned) {
    return NextResponse.json({ alreadyTerminal: true, status: cas.status });
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

  return NextResponse.json({ cancelled: true, orphan: !hadActiveSession });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withExtractedTraceContext(request.headers, async () => handleGet(request, id));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withExtractedTraceContext(request.headers, async () => handleDelete(request, id));
}
