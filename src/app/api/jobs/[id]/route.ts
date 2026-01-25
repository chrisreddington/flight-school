/**
 * Jobs API - Get/Delete Individual Job
 * GET /api/jobs/[id] - Get job status and result
 * DELETE /api/jobs/[id] - Delete/cancel a job
 */

import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { cancelRunningJob } from '../route';

const log = logger.withTag('Jobs API');

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  
  // Invalidate cache to get fresh data from disk
  jobStorage.invalidateCache();
  const job = await jobStorage.get(id);
  
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  return NextResponse.json(job);
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  
  log.info(`[Job ${id}] DELETE request received - attempting cancellation`);
  
  // First try to cancel if still running
  const wasCancelled = await cancelRunningJob(id);
  if (wasCancelled) {
    log.info(`[Job ${id}] Successfully cancelled running job`);
  }
  
  // Then delete from storage
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
}
