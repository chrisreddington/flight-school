/**
 * Internal worker endpoint that aggregates the four global sweeps.
 *
 * `POST /api/internal/jobs/sweep` with optional `{ nowMs }` for
 * deterministic tests. Returns count summaries only — never raw user
 * content.
 */

import { parseJsonBody } from '@/lib/api/request-utils';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import {
  redactTerminalJobs,
  sweepOrphanJobs,
  sweepStaleRunningJobs,
} from '@/worker/jobs/retention';
import { NextRequest, NextResponse } from 'next/server';

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

async function handleSweep(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  let nowMs = Date.now();
  try {
    const parseResult = await parseJsonBody<unknown>(request);
    if (parseResult.success && typeof parseResult.data === 'object' && parseResult.data !== null) {
      const candidate = (parseResult.data as { nowMs?: unknown }).nowMs;
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        nowMs = candidate;
      }
    }
  } catch {
    // No body / unparseable body — default to Date.now().
  }

  const staleRunningJobs = await sweepStaleRunningJobs(nowMs);
  const orphanJobs = await sweepOrphanJobs();
  const redactedTerminalJobs = await redactTerminalJobs();

  return NextResponse.json({ staleRunningJobs, orphanJobs, redactedTerminalJobs });
}

export async function POST(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleSweep(request));
}
