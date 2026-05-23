/**
 * SSE Streaming Utilities for API Routes
 *
 * Shared utilities for creating Server-Sent Events (SSE) responses.
 * Eliminates duplicate SSE setup logic across API routes.
 *
 * @module api/streaming-utils
 */

/**
 * Standard SSE response headers.
 *
 * - Content-Type: Required for SSE
 * - Cache-Control: Prevent caching of streamed data
 * - Connection: Keep connection alive
 * - X-Accel-Buffering: Disable nginx buffering
 * - Transfer-Encoding: Explicit chunked encoding
 */
const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Transfer-Encoding': 'chunked',
};

/**
 * SSE stream event with type discriminator.
 */
interface SSEStreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * SSE error event structure.
 */
interface SSEErrorEvent {
  type: 'error';
  message: string;
}

/**
 * Default heartbeat interval in milliseconds.
 *
 * Azure Container Apps Consumption ingress closes idle connections at ~240s.
 * 25 seconds leaves comfortable margin while staying friendly to most other
 * proxies (Cloudflare ~100s, nginx default 60s, etc.).
 */
const DEFAULT_HEARTBEAT_MS = 25_000;

/**
 * Options for creating an SSE response.
 */
interface CreateSSEResponseOptions<TMeta = Record<string, unknown>> {
  /** Called when the stream ends normally (before [DONE]) */
  onComplete?: () => TMeta | void | Promise<TMeta | void>;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Cleanup function called in finally block */
  cleanup?: () => void;
  /**
   * Interval in milliseconds between SSE comment-frame heartbeats (`: heartbeat\n\n`).
   *
   * Defaults to 25_000 (25s) to stay under Azure Container Apps' ~240s ingress
   * idle timeout on the Consumption plan. Set to `0` or `false` to disable the
   * heartbeat (primarily useful in tests).
   */
  heartbeatMs?: number | false;
}

/**
 * Creates an SSE Response from an async generator of events.
 *
 * This utility standardizes the SSE stream setup across API routes,
 * handling encoding, error handling, and proper cleanup.
 *
 * ## Heartbeats
 *
 * On stream open an initial `: connected\n\n` comment frame is sent immediately.
 * This defeats proxy response buffering (some intermediaries wait for the first
 * bytes before flushing headers) and lets clients confirm the SSE channel is live.
 *
 * A periodic `: heartbeat\n\n` comment frame is then sent every
 * {@link CreateSSEResponseOptions.heartbeatMs} ms (default 25_000). This keeps
 * the connection from being closed by idle-timeout-enforcing proxies — most
 * notably Azure Container Apps Consumption ingress, which terminates idle
 * connections at ~240s. See `docs/deployment-aca.md` and
 * `docs/architecture-multitenant.md` for the deployment context.
 *
 * Per the SSE spec, lines starting with `:` are comments — clients ignore them
 * but they reset proxy idle timers. They are NOT JSON.
 *
 * @typeParam T - Type of stream events
 * @typeParam TMeta - Type of metadata sent on completion
 * @param streamGenerator - Async generator that yields SSE events
 * @param options - Optional callbacks for completion, error, cleanup, and heartbeat interval
 * @returns Response with SSE stream body
 *
 * @example
 * ```typescript
 * // In an API route (see src/app/api/challenge/author/route.ts)
 * const { stream, cleanup, model, newConversationId } =
 *   await createGenericStreamingSession(\{ prompt, identity \});
 * const startTime = nowMs();
 *
 * return createSSEResponse(
 *   async function* () \{
 *     for await (const event of stream) \{
 *       if (event.type === 'delta') \{
 *         yield \{ type: 'delta' as const, content: event.content \};
 *       \}
 *     \}
 *   \},
 *   \{
 *     onComplete: () => (\{ type: 'meta', model, conversationId: newConversationId, totalMs: nowMs() - startTime \}),
 *     cleanup,
 *   \},
 * );
 * ```
 */
export function createSSEResponse<T extends SSEStreamEvent, TMeta extends SSEStreamEvent = SSEStreamEvent>(
  streamGenerator: () => AsyncGenerator<T, void, undefined>,
  options?: CreateSSEResponseOptions<TMeta>
): Response {
  const encoder = new TextEncoder();
  const heartbeatMs = options?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const heartbeatEnabled = typeof heartbeatMs === 'number' && heartbeatMs > 0;
  let cancelCleanup: (() => void) | null = null;

  const readable = new ReadableStream({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | null = null;

      const clearHeartbeat = (): void => {
        if (heartbeat !== null) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      // Expose clearer to the cancel() handler via the closure.
      cancelCleanup = clearHeartbeat;

      try {
        // Initial comment frame to defeat proxy buffering and confirm the channel is live.
        controller.enqueue(encoder.encode(`: connected\n\n`));

        if (heartbeatEnabled) {
          heartbeat = setInterval(() => {
            if (controller.desiredSize === null) {
              clearHeartbeat();
              return;
            }
            try {
              controller.enqueue(encoder.encode(`: heartbeat\n\n`));
            } catch {
              // Stream already toast — stop pumping.
              clearHeartbeat();
            }
          }, heartbeatMs as number);
        }

        for await (const event of streamGenerator()) {
          // Check if stream is still open before writing
          if (controller.desiredSize === null) break;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }

        // Send metadata if onComplete returns data
        if (options?.onComplete && controller.desiredSize !== null) {
          const meta = await options.onComplete();
          if (meta && controller.desiredSize !== null) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(meta)}\n\n`));
          }
        }

        // Send termination marker
        if (controller.desiredSize !== null) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        controller.close();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Stream error';
        options?.onError?.(error instanceof Error ? error : new Error(errorMessage));

        // Send error event to client if stream still open
        if (controller.desiredSize !== null) {
          const errorEvent: SSEErrorEvent = {
            type: 'error',
            message: errorMessage,
          };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          } catch {
            // Stream already closed, ignore
          }
        }
        controller.close();
      } finally {
        clearHeartbeat();
        options?.cleanup?.();
      }
    },
    cancel() {
      // Consumer aborted (e.g. client disconnected). Ensure the heartbeat
      // interval is cleared even if start()'s finally hasn't run yet.
      cancelCleanup?.();
    },
  });

  return new Response(readable, {
    headers: SSE_HEADERS,
  });
}
