/**
 * Web SSE proxy for AI activity events.
 *
 * `GET /api/ai-activity/stream?cursor=&include=`
 *
 * Forwards transparently to `/api/internal/ai-activity/stream` —
 * pipes the upstream body verbatim (no parse/re-emit) so SSE
 * semantics, ids, and heartbeats are preserved end-to-end. Honours
 * `Last-Event-ID` for resume.
 */
import { handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import {
  captureTracePropagationHeaders,
  mergeTracePropagationHeaders,
} from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Transfer-Encoding': 'chunked',
};

export async function GET(request: NextRequest): Promise<Response> {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (err) {
    return handleUnauthorizedError(err);
  }

  const workerConfig = getCopilotWorkerConfig();
  if (!workerConfig) {
    return NextResponse.json({ error: 'Worker not configured' }, { status: 503 });
  }

  const forwardParams = new URLSearchParams();
  const include = request.nextUrl.searchParams.get('include');
  if (include) forwardParams.set('include', include);
  const cursor = request.nextUrl.searchParams.get('cursor');
  if (cursor) forwardParams.set('cursor', cursor);

  const qs = forwardParams.toString();
  const upstreamUrl = `${workerConfig.baseUrl}/api/internal/ai-activity/stream${
    qs ? `?${qs}` : ''
  }`;

  const headers: Record<string, string> = mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${workerConfig.secret}`,
      'x-user-id': userId,
      accept: 'text/event-stream',
    },
    captureTracePropagationHeaders(),
  );
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId !== null) headers['last-event-id'] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers,
      signal: request.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json({ error: 'Worker unreachable' }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    // Forward upstream status/body so debugging shows the real failure
    // instead of a generic 502. Preserve the JSON content-type when the
    // upstream emitted JSON; otherwise fall back to text/plain.
    const status = upstream.status || 502;
    const text = await upstream.text().catch(() => '');
    const contentType = upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8';
    return new Response(text, { status, headers: { 'content-type': contentType } });
  }

  return new Response(upstream.body, { status: 200, headers: SSE_HEADERS });
}
