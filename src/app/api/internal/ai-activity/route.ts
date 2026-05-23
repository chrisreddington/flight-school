/**
 * Worker-internal AI activity collection endpoints.
 *
 * `GET /api/internal/ai-activity?include=full|public&cursor=<id>`
 *   Returns `{ events, stats }`. When `cursor` is provided and the
 *   referenced event is still retained, returns only events strictly
 *   after that id. When the cursor is unknown/evicted the full
 *   retained set is returned (replace semantics).
 *
 * `DELETE /api/internal/ai-activity`
 *   Clears the in-memory ring for `x-user-id`, removes the durable
 *   file, broadcasts a clear-frame to live subscribers without
 *   closing them.
 */
import { activityBus } from '@/lib/copilot/activity/activity-bus';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import { resolveIncludeMode } from '@/lib/copilot/activity/include-mode';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest, NextResponse } from 'next/server';

import { authorizeInternalActivity } from './auth';

// Guarded by COPILOT_WORKER_SECRET via authorizeInternalActivity.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleGet(request: NextRequest) {
  const authResult = authorizeInternalActivity(request);
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.auth;

  await activityLoggerWorker.ensureHydrated(userId);

  const cursor = request.nextUrl.searchParams.get('cursor');
  const includeMode = resolveIncludeMode(request);
  const includeFull = includeMode === 'full';

  const { events: rawEvents } = activityBus.resolveCursor(userId, cursor);
  const events = rawEvents.map((event) => toPublicActivityEvent(event, { includeFull }));
  const stats = activityLoggerWorker.getStats(userId);

  return NextResponse.json({ events, stats });
}

async function handleDelete(request: NextRequest) {
  const authResult = authorizeInternalActivity(request);
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.auth;

  try {
    await activityLoggerWorker.clear(userId);
  } catch (err) {
    return NextResponse.json(
      { error: 'activity_delete_failed', message: (err as Error).message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}

export async function GET(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleGet(request));
}

export async function DELETE(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleDelete(request));
}
