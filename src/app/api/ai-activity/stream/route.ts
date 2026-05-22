/**
 * AI Activity Stream API Route (Server-Sent Events)
 * GET /api/ai-activity/stream
 *
 * Pushes activity events to clients in real-time using SSE.
 * **Per-user**: only events owned by the authenticated caller are emitted.
 */

import { requireUserContext, UnauthorizedError } from '@/lib/auth/context';
import { activityLogger } from '@/lib/copilot/activity/logger';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let userId: string;
  try {
    ({ userId } = await requireUserContext());
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial events scoped to this user.
      const events = activityLogger.getEvents(userId);
      const initData = JSON.stringify({ type: 'init', events });
      controller.enqueue(encoder.encode(`data: ${initData}\n\n`));

      // Subscribe to new events — filter to this user before forwarding.
      const unsubscribe = activityLogger.subscribe((event: AIActivityEvent) => {
        if (controller.desiredSize === null) return;
        if (event.userId !== userId) return;

        try {
          const eventData = JSON.stringify({ type: 'event', event });
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
