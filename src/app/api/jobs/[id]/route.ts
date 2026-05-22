/**
 * Jobs API - Get/Delete Individual Job
 * GET /api/jobs/[id] - Get job status and result (caller must own the job)
 * DELETE /api/jobs/[id] - Cancel/delete a job (caller must own the job)
 *
 * Both endpoints enforce multi-tenant ownership: jobs belonging to another
 * user return `404 Not Found` (not 403) to avoid leaking job-id existence
 * across tenants.
 */

import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { NextRequest, NextResponse } from 'next/server';
import { cancelRunningJob } from '../route';

const log = logger.withTag('Jobs API');

interface RouteContext {
  params: Promise<{ id: string }>;
}

function unauthorized(err: UnauthorizedError): NextResponse {
  return NextResponse.json({ error: err.message }, { status: 401 });
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUserContext();
    const { id } = await context.params;

    jobStorage.invalidateCache();
    const job = await jobStorage.get(id);

    // Treat "not found" and "not yours" identically to avoid leaking
    // existence of jobs across tenants.
    if (!job || job.userId !== userId) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized(err);
    throw err;
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  try {
    const { userId } = await requireUserContext();
    const { id } = await context.params;

    log.info(`[Job ${id}] DELETE request received - attempting cancellation`);

    const existing = await jobStorage.get(id);
    if (!existing || existing.userId !== userId) {
      // Refuse to cancel/delete jobs we don't own; 404 not 403 to avoid leakage.
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const wasCancelled = await cancelRunningJob(id);
    if (wasCancelled) {
      log.info(`[Job ${id}] Successfully cancelled running job`);
    }

    const deleted = await jobStorage.delete(id);

    if (!deleted && !wasCancelled) {
      log.warn(`[Job ${id}] Job not found in storage or running jobs`);
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    log.info(`[Job ${id}] Job cancelled/deleted successfully (wasCancelled: ${wasCancelled}, deletedFromStorage: ${deleted})`);

    return NextResponse.json({
      success: true,
      cancelled: wasCancelled,
      deletedFromStorage: deleted,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorized(err);
    throw err;
  }
}
