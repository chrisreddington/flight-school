/**
 * Worker-internal AI activity SSE endpoint.
 *
 * `GET /api/internal/ai-activity/stream?cursor=<event.id>&include=...`
 *   Emits `id: <event.id>\ndata: { type:'event', event }\n\n` for each
 *   live event broadcast through the bus. The initial frame is
 *   `{ type:'init', events, cursor }` with the current retained set
 *   resolved against the cursor (replace semantics on evicted cursors).
 *   Honours both `?cursor=` and `Last-Event-ID` (header takes precedence).
 */
import { activityBus, type ActivityBusFrame } from '@/lib/copilot/activity/activity-bus';
import { toPublicActivityEvent } from '@/lib/copilot/activity/dto';
import { resolveIncludeMode } from '@/lib/copilot/activity/include-mode';
import { activityLoggerWorker } from '@/lib/copilot/activity/logger-worker';
import { withExtractedTraceContext } from '@/lib/observability/context-propagation';
import { NextRequest } from 'next/server';

import { authorizeInternalActivity } from '../auth';

// Guarded by COPILOT_WORKER_SECRET via authorizeInternalActivity.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

async function handleStream(request: NextRequest): Promise<Response> {
  const authResult = authorizeInternalActivity(request);
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.auth;

  const includeFull = resolveIncludeMode(request) === 'full';

  // Last-Event-ID takes precedence over `?cursor=` (per SSE spec).
  const lastEventId = request.headers.get('last-event-id');
  const queryCursor = request.nextUrl.searchParams.get('cursor');
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
      // Emit an `init` frame ONLY when the client needs replace semantics:
      // first connect (no cursor) OR cursor was unknown/evicted. For a
      // known cursor (replay mode) we skip `init` entirely because
      // `useAIActivity` treats every `init` as replace-all — sending
      // `{type:'init',events:[]}` would wipe the client's existing list.
      if (mode === 'init') {
        const initFrame = {
          type: 'init' as const,
          events: initialEvents,
          cursor: initialCursor,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(initFrame)}\n\n`));
      }

      // Replay events at and after the cursor (inclusive). Re-delivering
      // the cursor event itself is required so a client that disconnected
      // mid-pending can pick up subsequent in-place updates (the bus stores
      // one slot per id, so we send the latest version). The client upserts
      // by `event.id`, making the re-delivery idempotent.
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

export async function GET(request: NextRequest) {
  return withExtractedTraceContext(request.headers, async () => handleStream(request));
}
