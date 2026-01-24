/**
 * PATCH /api/ai-activity/metrics
 * 
 * Updates an existing activity event with client-side metrics.
 * This allows the activity panel to show the same metrics as chat message badges.
 */

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

/**
 * PATCH /api/ai-activity/metrics
 * Updates an activity event with client-side performance metrics.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body: UpdateActivityMetricsRequest = await request.json();
    const { eventId, clientMetrics } = body;

    if (!eventId || !clientMetrics) {
      return NextResponse.json(
        { error: 'eventId and clientMetrics are required' },
        { status: 400 }
      );
    }

    // Update the event with client metrics
    const updated = activityLogger.updateWithClientMetrics(eventId, clientMetrics);
    
    if (!updated) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      eventId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update activity metrics';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
