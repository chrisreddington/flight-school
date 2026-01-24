/**
 * Jobs API - Get/Delete Individual Job
 * GET /api/jobs/[id] - Get job status and result
 * DELETE /api/jobs/[id] - Delete a job
 */

import { jobStorage } from '@/lib/jobs';
import { NextRequest, NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params;
  const job = jobStorage.get(id);
  
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
  const deleted = jobStorage.delete(id);
  
  if (!deleted) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }
  
  return NextResponse.json({ success: true });
}
