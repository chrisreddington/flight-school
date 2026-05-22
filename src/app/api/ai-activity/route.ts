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

import { apiSuccess } from '@/lib/api';
import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import { now } from '@/lib/utils/date-utils';
import { NextResponse } from 'next/server';

export interface AIActivityResponse {
  events: ReturnType<typeof activityLogger.getEvents>;
  stats: ReturnType<typeof activityLogger.getStats>;
}

/**
 * GET /api/ai-activity
 * Returns activity events and stats owned by the authenticated caller.
 */
export async function GET() {
  try {
    const { userId } = await requireUserContext();
    const events = activityLogger.getEvents(userId);
    const stats = activityLogger.getStats(userId);

    return apiSuccess<AIActivityResponse>(
      { events, stats },
      { fetchedAt: now(), eventCount: events.length }
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
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
    return apiSuccess({ cleared: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
