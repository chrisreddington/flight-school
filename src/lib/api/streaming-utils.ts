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
export interface SSEStreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * SSE error event structure.
 */
export interface SSEErrorEvent {
  type: 'error';
  message: string;
}

/**
 * Options for creating an SSE response.
 */
export interface CreateSSEResponseOptions<TMeta = Record<string, unknown>> {
  /** Called when the stream ends normally (before [DONE]) */
  onComplete?: () => TMeta | void | Promise<TMeta | void>;
  /** Called when an error occurs */
  onError?: (error: Error) => void;
  /** Cleanup function called in finally block */
  cleanup?: () => void;
}

/**
 * Creates an SSE Response from an async generator of events.
 *
 * This utility standardizes the SSE stream setup across API routes,
 * handling encoding, error handling, and proper cleanup.
 *
 * @typeParam T - Type of stream events
 * @typeParam TMeta - Type of metadata sent on completion
 * @param streamGenerator - Async generator that yields SSE events
 * @param options - Optional callbacks for completion, error, and cleanup
 * @returns Response with SSE stream body
 *
 * @example
 * ```typescript
 * // In an API route
 * const { stream, cleanup, model } = await createStreamingSession(prompt);
 * const startTime = nowMs();
 *
 * return createSSEResponse(
 *   async function* () {
 *     for await (const event of stream) {
 *       yield event;
 *     }
 *   },
 *   {
 *     onComplete: () => ({
 *       type: 'meta',
 *       model,
 *       totalMs: nowMs() - startTime,
 *     }),
 *     cleanup,
 *   }
 * );
 * ```
 */
export function createSSEResponse<T extends SSEStreamEvent, TMeta extends SSEStreamEvent = SSEStreamEvent>(
  streamGenerator: () => AsyncGenerator<T, void, undefined>,
  options?: CreateSSEResponseOptions<TMeta>
): Response {
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      try {
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
        options?.cleanup?.();
      }
    },
  });

  return new Response(readable, {
    headers: SSE_HEADERS,
  });
}
