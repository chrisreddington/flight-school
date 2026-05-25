/** Handler for `GET /api/internal/ai-activity/stream` — SSE. */

import { activityBus, type ActivityBusFrame } from '@/lib/copilot/activity/activity-bus';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import { resolveIncludeMode } from '@/lib/copilot/activity/include-mode';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export async function handleActivityStream(
  request: Request,
  userId: string,
): Promise<Response> {
  const includeFull = resolveIncludeMode(request) === 'full';

  const lastEventId = request.headers.get('last-event-id');
  const queryCursor = new URL(request.url).searchParams.get('cursor');
  const cursor = lastEventId ?? queryCursor;

  await activityLoggerWorker.ensureHydrated(userId);

  const { mode, events: initialRaw } = activityBus.resolveCursor(userId, cursor);
  const initialEvents = initialRaw.map((event) =>
    toPublicActivityEvent(event, { includeFull }),
  );
  const initialCursor =
    initialRaw.length > 0 ? initialRaw[initialRaw.length - 1].id : null;

  const { iterator, unsubscribe } = activityBus.subscribe(userId);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      if (mode === 'init') {
        const initFrame = {
          type: 'init' as const,
          events: initialEvents,
          cursor: initialCursor,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initFrame)}\n\n`));
      }

      if (mode === 'replay') {
        for (const event of initialRaw) {
          const publicEvent = toPublicActivityEvent(event, { includeFull });
          controller.enqueue(encoder.encode(`id: ${event.id}\n`));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'event', event: publicEvent })}\n\n`),
          );
        }
      }

      const HEARTBEAT_INTERVAL_MS = 30_000;
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      const abort = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener('abort', abort);

      try {
        for await (const frame of iterator as AsyncIterable<ActivityBusFrame>) {
          if (frame.type === 'init') {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'init', events: [], cursor: null })}\n\n`,
              ),
            );
            continue;
          }
          const publicEvent = toPublicActivityEvent(frame.event, { includeFull });
          controller.enqueue(encoder.encode(`id: ${frame.event.id}\n`));
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'event', event: publicEvent })}\n\n`,
            ),
          );
        }
      } catch {
        // iterator closed
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
        request.signal.removeEventListener('abort', abort);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      unsubscribe();
    },
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
