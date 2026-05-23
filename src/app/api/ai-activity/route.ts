/**
 * AI Activity API Route
 * GET /api/ai-activity
 * DELETE /api/ai-activity
 *
 * Exposes server-side activity logger events **scoped to the caller**.
 * The activity logger is a server-side singleton that captures all SDK
 * operations across every user, so this endpoint MUST filter by the
 * authenticated user — never return the raw buffer.
 */

import { apiSuccess, handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import {
  clearShadowActivityEvents,
  loadShadowActivityEvents,
} from '@/lib/copilot/activity/shadow-store';
import { mergeActivityEventStreams } from '@/lib/copilot/activity/stream-cursor';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import { now } from '@/lib/utils/date-utils';
import { NextRequest } from 'next/server';

export interface AIActivityResponse {
  events: ReturnType<typeof toPublicActivityEvent>[];
  stats: ReturnType<typeof activityLogger.getStats>;
}

/**
 * GET /api/ai-activity
 * Returns activity events and stats owned by the authenticated caller.
 *
 * Events are mapped through {@link toPublicActivityEvent} so
 * `output.fullResponse` and MCP tool args/results never reach the
 * browser. The dev-only `?include=full` query unlocks the full
 * response, gated server-side by `NODE_ENV === 'development'` (the
 * gate is inside the DTO).
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireUserContext();
    const includeFull = request.nextUrl.searchParams.get('include') === 'full';
    const shadowEvents = await loadShadowActivityEvents(userId);
    const liveEvents = activityLogger.getEvents(userId);
    const mergedEvents = mergeActivityEventStreams(shadowEvents, liveEvents);
    const events = mergedEvents.map((event) =>
      toPublicActivityEvent(event, { includeFull }),
    );
    const stats = activityLogger.getStats(userId);

    return apiSuccess<AIActivityResponse>(
      { events, stats },
      { fetchedAt: now(), eventCount: events.length }
    );
  } catch (err) {
    return handleUnauthorizedError(err);
  }
}

/**
 * DELETE /api/ai-activity
 * Clears activity events owned by the authenticated caller only.
 */
export async function DELETE() {
  try {
    const { userId } = await requireUserContext();
    activityLogger.clear(userId);
    await clearShadowActivityEvents(userId);
    return apiSuccess({ cleared: true });
  } catch (err) {
    return handleUnauthorizedError(err);
  }
}
