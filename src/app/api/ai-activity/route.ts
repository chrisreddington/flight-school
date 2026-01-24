/**
 * AI Activity API Route
 * GET /api/ai-activity
 * DELETE /api/ai-activity
 *
 * Exposes server-side activity logger events to the client.
 * The activity logger is a server-side singleton that captures all SDK operations.
 * This endpoint enables the client-side Activity Panel to display those events.
 */

import { apiSuccess } from '@/lib/api';
import { activityLogger } from '@/lib/copilot/activity/logger';
import { now } from '@/lib/utils/date-utils';

export interface AIActivityResponse {
  events: ReturnType<typeof activityLogger.getEvents>;
  stats: ReturnType<typeof activityLogger.getStats>;
}

/**
 * GET /api/ai-activity
 * Returns all activity events and stats from the server-side logger.
 */
export async function GET() {
  const events = activityLogger.getEvents();
  const stats = activityLogger.getStats();

  return apiSuccess<AIActivityResponse>(
    { events, stats },
    { fetchedAt: now(), eventCount: events.length }
  );
}

/**
 * DELETE /api/ai-activity
 * Clears all activity events from the server-side logger.
 */
export async function DELETE() {
  activityLogger.clear();
  return apiSuccess({ cleared: true });
}
