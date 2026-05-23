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

  // Mark cancelled FIRST so the executor sees terminal intent before
  // we disrupt its session. Otherwise destroy() can race the executor
  // into completed/failed before the cancel status lands.
  await jobStorage.markCancelled(id);
  try {
    await requestCancellation(id);
  } catch (err) {
    log.warn(`[Job ${id}] requestCancellation threw after markCancelled`, err);
  }

  return NextResponse.json({ cancelled: true });
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
