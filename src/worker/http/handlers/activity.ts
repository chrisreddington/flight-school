/** Handlers for `/api/internal/ai-activity` — GET (list+stats) and DELETE (clear). */

import { activityBus } from '@/lib/copilot/activity/activity-bus';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import { resolveIncludeMode } from '@/lib/copilot/activity/include-mode';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';

export async function handleActivityGet(request: Request, userId: string): Promise<Response> {
  await activityLoggerWorker.ensureHydrated(userId);

  const cursor = new URL(request.url).searchParams.get('cursor');
  const includeMode = resolveIncludeMode(request);
  const includeFull = includeMode === 'full';

  const { events: rawEvents } = activityBus.resolveCursor(userId, cursor);
  const events = rawEvents.map((event) => toPublicActivityEvent(event, { includeFull }));
  const stats = activityLoggerWorker.getStats(userId);

  return Response.json({ events, stats });
}

export async function handleActivityDelete(_request: Request, userId: string): Promise<Response> {
  try {
    await activityLoggerWorker.clear(userId);
  } catch (err) {
    return Response.json({ error: 'activity_delete_failed', message: (err as Error).message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
