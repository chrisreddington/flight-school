/**
 * PATCH /api/ai-activity/metrics
 *
 * Updates an existing activity event with client-side metrics.
 * **Per-user**: a user can only update metrics on their own events.
 */

import { authErrorResponse } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
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
      return NextResponse.json(
        { error: 'eventId and clientMetrics are required' },
        { status: 400 }
      );
    }

    const updated = activityLogger.updateWithClientMetrics(userId, eventId, clientMetrics);

    if (!updated) {
      // 404 for both "not found" and "not yours" — don't leak existence.
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, eventId });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    const errorMessage = err instanceof Error ? err.message : 'Failed to update activity metrics';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
