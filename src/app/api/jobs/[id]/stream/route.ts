/**
 * Web SSE proxy for job streams.
 *
 * GET /api/jobs/[id]/stream?cursor=<seq>
 *
 * Authenticated per-user via Auth.js session (NOT `withUserGuards` —
 * transport reconnects must not be rate-limited as new AI work). The
 * web tier validates ownership of the job, then proxies the SSE stream
 * from the worker process, preserving back-pressure and abort propagation.
 *
 * Trace context is propagated to the worker via `mergeTracePropagationHeaders`.
 */

import { handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import {
  captureTracePropagationHeaders,
  mergeTracePropagationHeaders,
} from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { getWorkerJob } from '../../worker-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Streaming SSE connection: hold the route open for the worker's stream
// lifetime. Default of 10s would cut clients off mid-token.
export const maxDuration = 300;

interface Params {
  params: Promise<{ id: string }>;
}

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Transfer-Encoding': 'chunked',
};

export async function GET(request: NextRequest, { params }: Params) {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (err) {
    return handleUnauthorizedError(err);
  }

  const { id } = await params;

  // Check worker config BEFORE the ownership probe. If the worker is
  // unconfigured we want a deterministic 503 instead of the probe
  // throwing inside `getWorkerJob`.
  const workerConfig = getCopilotWorkerConfig();
  if (!workerConfig) {
    return NextResponse.json({ error: 'Worker not configured' }, { status: 503 });
  }

  // Capture trace context once — used for both the ownership probe and
  // the SSE proxy fetch so both legs land on the same trace.
  const traceCtxRaw = captureTracePropagationHeaders();
  const traceCtx = Object.keys(traceCtxRaw).length > 0 ? traceCtxRaw : undefined;

  let job;
  try {
    job = await getWorkerJob(id, userId, traceCtx);
  } catch {
    return NextResponse.json(
      { error: 'Job service temporarily unavailable. Please retry.' },
      { status: 503 },
    );
  }
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const urlObj = new URL(request.url);
  const cursorParam = urlObj.searchParams.get('cursor');
  const lastEventId = request.headers.get('last-event-id');
  const qs = new URLSearchParams();
  if (cursorParam !== null) qs.set('cursor', cursorParam);

  const upstreamUrl = `${workerConfig.baseUrl}/api/internal/jobs/${encodeURIComponent(id)}/stream${
    qs.toString() ? `?${qs.toString()}` : ''
  }`;

  const upstreamHeaders: Record<string, string> = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${workerConfig.secret}`,
      'x-user-id': userId,
      accept: 'text/event-stream',
    },
    // Reuse the context we captured for the ownership probe so the SSE
    // producer span is linked into the same trace as the proxy span.
    traceCtxRaw,
  );
  if (lastEventId !== null) upstreamHeaders['last-event-id'] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      signal: request.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json({ error: 'Worker unreachable' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json({ error: 'Stream unavailable' }, { status });
  }

  return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
}
