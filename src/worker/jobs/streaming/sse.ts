/**
 * SSE producer helpers for streaming job events to the web tier.
 *
 * Uses raw event id/data framing instead of the generic `createSSEResponse`
 * helper because we need `id:` markers (for client `?cursor=` recovery via
 * `Last-Event-ID` semantics) and a slightly different terminal contract.
 */

import { logger } from '@/lib/logger';

import { jobEventBus } from './event-bus';
import type { JobStreamEvent, SequencedJobStreamEvent } from './types';
import { isTerminalEvent } from './types';

const log = logger.withTag('JobStreamSSE');

const HEARTBEAT_MS = 25_000;

const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Transfer-Encoding': 'chunked',
};

function encodeFrame(encoder: TextEncoder, sequenced: SequencedJobStreamEvent): Uint8Array {
  const payload = JSON.stringify(sequenced.event);
  return encoder.encode(`id: ${sequenced.seq}\ndata: ${payload}\n\n`);
}

/**
 * Build an SSE Response that replays buffered events for `jobId` from
 * `afterSeq` then subscribes for live events until either a terminal
 * event arrives or `abortSignal` fires.
 */
export function createJobStreamResponse(
  jobId: string,
  afterSeq: number,
  abortSignal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let closer: ((reason?: string) => void) | null = null;

  const stream = new ReadableStream(
    {
      async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const subscription = jobEventBus.subscribe(jobId);
      let closed = false;

      const close = (reason?: string): void => {
        if (closed) return;
        closed = true;
        if (heartbeat !== null) clearInterval(heartbeat);
        subscription.unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
        if (reason) log.debug(`[stream ${jobId}] closed: ${reason}`);
      };

      // Expose the close function to the outer ReadableStream so cancel()
      // (which fires when the consumer drops the response, e.g. proxy hop
      // or browser tab close) cleans up the bus subscription. Without this
      // the subscriber slot would leak until the worker process restarts.
      closer = close;

      abortSignal.addEventListener('abort', () => close('client-abort'), { once: true });

      // With a ByteLengthQueuingStrategy of 1 MiB highWaterMark, desiredSize
      // starts at 1_048_576 and ticks down as frames buffer up in the stream
      // controller. We close the stream only when:
      //   - desiredSize is null (controller errored), or
      //   - desiredSize is significantly negative (backlog > 256 KiB beyond
      //     the high-water mark) — a real consumer stall.
      //
      // We deliberately do NOT close on `desiredSize === 0`, because that is
      // the normal "queue is full right now, please slow down" signal that
      // the runtime resolves as soon as the consumer reads a chunk.
      const STALL_THRESHOLD_BYTES = -256 * 1024;
      const consumerStalled = (): boolean => {
        const ds = controller.desiredSize;
        return ds === null || ds < STALL_THRESHOLD_BYTES;
      };

      try {
        controller.enqueue(encoder.encode(`: connected\n\n`));

        heartbeat = setInterval(() => {
          if (consumerStalled()) {
            close('backpressure-heartbeat');
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            close('heartbeat-enqueue-failed');
          }
        }, HEARTBEAT_MS);

        const replay = jobEventBus.replay(jobId, afterSeq);
        let lastSentSeq = afterSeq;
        let terminalSeen = false;

        for (const sequenced of replay) {
          if (closed) return;
          if (consumerStalled()) {
            close('backpressure-during-replay');
            return;
          }
          controller.enqueue(encodeFrame(encoder, sequenced));
          lastSentSeq = sequenced.seq;
          if (isTerminalEvent(sequenced.event)) terminalSeen = true;
        }

        if (terminalSeen) {
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          close('terminal-in-replay');
          return;
        }

        if (jobEventBus.isTerminated(jobId)) {
          const tail = jobEventBus.replay(jobId, lastSentSeq);
          for (const sequenced of tail) {
            controller.enqueue(encodeFrame(encoder, sequenced));
          }
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          close('already-terminated');
          return;
        }

        for await (const sequenced of subscription.iterator) {
          if (closed) return;
          if (sequenced.seq <= lastSentSeq) continue;
          if (consumerStalled()) {
            close('backpressure');
            return;
          }
          controller.enqueue(encodeFrame(encoder, sequenced));
          lastSentSeq = sequenced.seq;
          if (isTerminalEvent(sequenced.event)) {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            close('terminal');
            return;
          }
        }
      } catch (err) {
        log.warn(`[stream ${jobId}] producer error:`, err);
        close('producer-error');
      }
    },
    cancel() {
      // Consumer (proxy hop) dropped the response. Run the same close
      // path used by abort so we tear down heartbeat + bus subscription.
      closer?.('consumer-cancel');
    },
    },
    // Byte-aware queuing: each enqueued Uint8Array counts its byteLength
    // toward the high-water mark. desiredSize starts at 1 MiB and decrements
    // as bytes pile up. Combined with the STALL_THRESHOLD_BYTES check inside
    // start(), this gives ~1.25 MiB of headroom before we declare the
    // consumer stalled. That's plenty for healthy proxy/browser readers and
    // small enough that a genuinely dead consumer is shed promptly.
    new ByteLengthQueuingStrategy({ highWaterMark: 1_048_576 }),
  );

  return new Response(stream, { headers: SSE_HEADERS });
}

/**
 * Build a one-shot SSE Response that emits a synthesized terminal event
 * followed immediately by `[DONE]` and closes. Used when a job is known
 * to have reached a terminal status (via the durable job store) but its
 * event bus buffer has already been swept (e.g. reconnection after the
 * 5-minute retention window).
 *
 * Without this, a client reconnecting to a completed-and-swept job would
 * subscribe to a fresh empty buffer and wait forever.
 *
 * The emitted JSON conforms to the `JobStreamEvent` discriminated union
 * (see `./types.ts`) so consumers don't observe contract drift between
 * live, replay, and synthesized paths.
 *
 * NOTE: Synthesized terminal events are CONTROL-ONLY signals. `content` and
 * `toolEvents` may be empty even on `done`/`cancelled` because the durable
 * final payload isn't necessarily re-hydrated from the job index on this
 * path. Clients are expected to refresh canonical thread state from the
 * persisted job/thread after observing a terminal frame.
 */
export function createSynthesizedTerminalResponse(
  terminalEvent:
    | { type: 'done'; content?: string }
    | { type: 'failed'; message?: string }
    | { type: 'cancelled'; content?: string },
): Response {
  const encoder = new TextEncoder();
  let event: JobStreamEvent;
  if (terminalEvent.type === 'done') {
    event = {
      type: 'done',
      content: terminalEvent.content ?? '',
      toolEvents: [],
      hasActionableItem: false,
    };
  } else if (terminalEvent.type === 'failed') {
    event = { type: 'failed', message: terminalEvent.message ?? 'Job failed' };
  } else {
    event = {
      type: 'cancelled',
      content: terminalEvent.content ?? '',
      toolEvents: [],
    };
  }

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`: connected\n\n`));
      // seq=0 is intentional: this synthesized frame does not advance the
      // client cursor — the buffer it would map to was already swept.
      controller.enqueue(encoder.encode(`id: 0\ndata: ${JSON.stringify(event)}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
