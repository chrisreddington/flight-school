/**
 * Jobs API - Get/Delete Individual Job (web tier, thin proxy)
 *
 * GET    /api/jobs/[id] - Get job status and result (proxy → worker)
 * DELETE /api/jobs/[id] - Cancel the job (proxy → worker)
 *
 * Multi-tenant ownership is enforced on the worker; this proxy passes
 * the resolved `userId` as a query string so the worker can scope its
 * read. Mismatched ownership returns `404 Not Found` to avoid leaking
 * job-id existence across tenants.
 *
 * DELETE marks the record cancelled rather than hard-deleting; retention
 * sweeps clear it later. This preserves the synthesized-terminal SSE
 * path for late reconnects.
 */

import { logger } from '@/lib/logger';
import { handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { captureTracePropagationHeaders } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { cancelWorkerJobRecord, getWorkerJob } from './../worker-client';

const log = logger.withTag('Jobs API');

interface RouteContext {
  params: Promise<{ id: string }>;
}

function captureTraceContext() {
  const traceHeaders = captureTracePropagationHeaders();
  return Object.keys(traceHeaders).length > 0 ? traceHeaders : undefined;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
) {
  let userId: string;
  let id: string;
  try {
    ({ userId } = await requireUserContext());
    ({ id } = await context.params);
  } catch (err) {
    return handleUnauthorizedError(err);
  }

  try {
    const job = await getWorkerJob(id, userId, captureTraceContext());
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (err) {
    log.error(`[Job ${id}] Failed to fetch from worker`, { err });
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
) {
  let userId: string;
  let id: string;
  try {
    ({ userId } = await requireUserContext());
    ({ id } = await context.params);
  } catch (err) {
    return handleUnauthorizedError(err);
  }

  log.info(`[Job ${id}] DELETE request received - forwarding to worker`);

  let result;
  try {
    result = await cancelWorkerJobRecord(id, userId, captureTraceContext());
  } catch (err) {
    log.error(`[Job ${id}] Failed to cancel on worker`, { err });
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }

  // Worker reported the job missing (or not owned by this user). Mirror
  // the GET semantics so callers see a deterministic 404 instead of a
  // generic 500.
  if (result.notFound) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (result.alreadyTerminal) {
    return NextResponse.json({
      success: true,
      cancelled: false,
      deletedFromStorage: false,
      alreadyTerminal: true,
      status: result.status,
    });
  }

  return NextResponse.json({
    success: true,
    cancelled: result.cancelled,
    // Worker no longer hard-deletes on cancel; retention handles it.
    deletedFromStorage: false,
  });
}
