/**
 * Web proxy for the activity event metrics PATCH.
 *
 * `PATCH /api/ai-activity/metrics` body `{ eventId, clientMetrics }`
 *   Proxies to `PATCH /api/internal/ai-activity/event/${eventId}` with
 *   body `{ clientMetrics }`. Preserves the existing 404 semantics —
 *   the worker returns 404 for both "unknown id" and "not owned" so
 *   we don't leak existence.
 */
import { authErrorResponse } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import { captureTracePropagationHeaders, mergeTracePropagationHeaders } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

export interface UpdateActivityMetricsRequest {
  /** Event ID to update */
  eventId: string;
  /** Client-side metrics to add */
  clientMetrics: {
    /** Client-side time to first token in ms */
    firstTokenMs?: number;
    /** Client-side total time in ms */
    totalMs?: number;
  };
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const body: UpdateActivityMetricsRequest = await request.json();
    const { eventId, clientMetrics } = body;

    if (!eventId || !clientMetrics) {
      return NextResponse.json({ error: 'eventId and clientMetrics are required' }, { status: 400 });
    }

    const workerConfig = getCopilotWorkerConfig();
    if (!workerConfig) {
      return NextResponse.json({ error: 'Worker not configured' }, { status: 503 });
    }

    const headers = mergeTracePropagationHeaders(
      {
        authorization: `Bearer ${workerConfig.secret}`,
        'content-type': 'application/json',
        'x-user-id': userId,
      },
      captureTracePropagationHeaders(),
    );

    const upstream = await fetch(
      `${workerConfig.baseUrl}/api/internal/ai-activity/event/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ clientMetrics }),
      },
    );

    if (upstream.status === 404) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Worker unreachable' }, { status: 502 });
    }

    return NextResponse.json({ success: true, eventId });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const errorMessage = err instanceof Error ? err.message : 'Failed to update activity metrics';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
