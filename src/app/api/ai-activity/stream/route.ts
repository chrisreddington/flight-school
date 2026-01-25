/**
 * AI Activity Stream API Route (Server-Sent Events)
 * GET /api/ai-activity/stream
 *
 * Pushes activity events to clients in real-time using SSE.
 * No polling required - events are delivered as they happen.
 */

import { activityLogger } from '@/lib/copilot/activity/logger';
import type { AIActivityEvent } from '@/lib/copilot/activity/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial events
      const events = activityLogger.getEvents();
      const initData = JSON.stringify({ type: 'init', events });
      controller.enqueue(encoder.encode(`data: ${initData}\n\n`));

      // Subscribe to new events
      const unsubscribe = activityLogger.subscribe((event: AIActivityEvent) => {
        // Check if stream is still open before writing
        if (controller.desiredSize === null) return;
        
        try {
          const eventData = JSON.stringify({ type: 'event', event });
          controller.enqueue(encoder.encode(`data: ${eventData}\n\n`));
        } catch {
          // Stream closed, ignore
        }
      });

      // Heartbeat to keep connection alive (every 30s)
      const heartbeat = setInterval(() => {
        // Check if stream is still open before writing
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

      // Cleanup on close - Note: This is called when the stream errors,
      // but SSE connections closing normally may not trigger this.
      // The heartbeat failure will clean up in that case.
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
