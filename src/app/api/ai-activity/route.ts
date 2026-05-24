/**
 * Web proxy for AI activity events.
 *
 * `GET /api/ai-activity?cursor=&include=`
 * `DELETE /api/ai-activity`
 *
 * Thin proxy to the worker-internal endpoints. The web tier never
 * trusts a client-supplied `userId` — it sets `x-user-id` from the
 * server-resolved auth context and forwards query params verbatim.
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

function buildProxyHeaders(userId: string, secret: string) {
  return mergeTracePropagationHeaders(
    {
      authorization: `Bearer ${secret}`,
      'x-user-id': userId,
    },
    captureTracePropagationHeaders(),
  );
}

export async function GET(request: NextRequest) {
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
  const upstreamUrl = `${workerConfig.baseUrl}/api/internal/ai-activity${qs ? `?${qs}` : ''}`;

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: buildProxyHeaders(userId, workerConfig.secret),
      signal: request.signal,
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json({ error: 'Worker unreachable' }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
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

  try {
    const upstream = await fetch(`${workerConfig.baseUrl}/api/internal/ai-activity`, {
      method: 'DELETE',
      headers: buildProxyHeaders(userId, workerConfig.secret),
      signal: request.signal,
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return new Response(null, { status: 499 });
    }
    return NextResponse.json({ error: 'Worker unreachable' }, { status: 502 });
  }
}
