/**
 * Internal worker endpoints for per-user job data export and deletion.
 *
 * `GET /api/internal/jobs/user-data?userId=` — return every raw job
 * record owned by the user. Used by the data-export pipeline; this
 * route deliberately returns full records (no redaction) because the
 * caller is the user themselves.
 *
 * `DELETE /api/internal/jobs/user-data?userId=` — cancel every
 * in-flight job for the user (markCancelled + requestCancellation),
 * then delete every job record. Returns `{ deleted, cancelled }`.
 */

import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { requestCancellation } from '@/worker/jobs/executors/session-registry';
import { jobEventBus } from '@/worker/jobs/streaming/event-bus';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('InternalJobsUserData');

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

async function handleGet(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  const jobs = await jobStorage.getAll();
  const owned = jobs.filter((job) => job.userId === userId);
  return NextResponse.json({ jobs: owned });
}

async function handleDelete(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  const userId = new URL(request.url).searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  // Cancel any in-flight worker sessions for this user BEFORE deleting
  // job records. Otherwise executors keep streaming after their records
  // are gone, wasting compute and possibly hitting undefined state.
  //
  // We mirror the single-job DELETE route's semantics so SSE consumers
  // observing these jobs receive a terminal frame:
  //   - CAS to `cancelled` first so a live executor sees terminal intent.
  //   - Request session cancellation; the return tells us whether an
  //     active session was present.
  //   - For orphan jobs (no active session), emit a synthesized
  //     `cancelled` terminal to the event bus so any SSE client still
  //     attached unsticks instead of waiting indefinitely.
  const allJobs = await jobStorage.getAll();
  const ownedRunning = allJobs.filter(
    (j) => j.userId === userId && (j.status === 'running' || j.status === 'pending'),
  );
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
  return NextResponse.json({ deleted, cancelled });
}

export async function GET(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleGet(request));
}

export async function DELETE(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleDelete(request));
}
