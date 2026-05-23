import { parseJsonBody } from '@/lib/api/request-utils';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { requestCancellation } from '@/worker/jobs/executors/session-registry';
import { NextRequest, NextResponse } from 'next/server';

interface CancelWorkerJobRequest {
  jobId: string;
}

function parseCancelRequest(data: unknown): CancelWorkerJobRequest | null {
  if (typeof data !== 'object' || data === null) return null;
  const raw = data as Partial<CancelWorkerJobRequest>;
  if (typeof raw.jobId !== 'string') return null;
  return { jobId: raw.jobId };
}

async function handleCancelRequest(request: NextRequest) {
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

  const parseResult = await parseJsonBody<unknown>(request);
  if (!parseResult.success) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  const cancelRequest = parseCancelRequest(parseResult.data);
  if (!cancelRequest) {
    return NextResponse.json({ error: 'Invalid worker request' }, { status: 400 });
  }

  const cancelled = await requestCancellation(cancelRequest.jobId);
  return NextResponse.json({ cancelled });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleCancelRequest(request));
}
