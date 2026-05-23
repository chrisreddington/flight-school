/**
 * AI Activity Stream API Route (Server-Sent Events)
 * GET /api/ai-activity/stream
 *
 * Pushes activity events to clients in real-time using SSE.
 * **Per-user**: only events owned by the authenticated caller are emitted.
 */

import { handleUnauthorizedError } from '@/lib/api';
import { requireUserContext } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import { loadShadowActivityEvents } from '@/lib/copilot/activity/shadow-store';
import { eventsAfterCursor, mergeActivityEventStreams } from '@/lib/copilot/activity/stream-cursor';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (err) {
    return handleUnauthorizedError(err);
  }

  const includeFull = request.nextUrl.searchParams.get('include') === 'full';
  const cursor = request.nextUrl.searchParams.get('cursor');
  const shadowEvents = await loadShadowActivityEvents(userId);
  const liveEvents = activityLogger.getEvents(userId);
  const initialEvents = eventsAfterCursor(
    mergeActivityEventStreams(shadowEvents, liveEvents),
    cursor,
  );
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial events scoped to this user — through the public DTO
      // so `fullResponse` and MCP tool args never leak.
      const events = initialEvents.map((event) =>
        toPublicActivityEvent(event, { includeFull }),
      );
      const initData = JSON.stringify({ type: 'init', events });
      controller.enqueue(encoder.encode(`data: ${initData}\n\n`));

      // Subscribe to new events — filter by userId AND redact before
      // forwarding. Both gates are necessary; one without the other
      // would either leak content or another user's events.
      const unsubscribe = activityLogger.subscribe((event: AIActivityEvent) => {
        if (controller.desiredSize === null) return;
        if (event.userId !== userId) return;

        try {
          const publicEvent = toPublicActivityEvent(event, { includeFull });
          const eventData = JSON.stringify({ type: 'event', event: publicEvent });
          controller.enqueue(encoder.encode(`id: ${event.id}\n`));
          controller.enqueue(encoder.encode(`data: ${eventData}\n\n`));
        } catch {
          // Stream closed, ignore
        }
      });

      // Heartbeat to keep connection alive (every 30s)
      const heartbeat = setInterval(() => {
        if (controller.desiredSize === null) {
          clearInterval(heartbeat);
          return;
        }

        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
