/**
 * `fetch()`-based Server-Sent Events client.
 *
 * Replaces the platform `EventSource` so we can:
 *
 * 1. **Inject W3C trace context** automatically. Browser-side
 *    `FetchInstrumentation` (configured in `src/lib/observability/browser-otel.ts`)
 *    injects `traceparent`/`tracestate` on every `fetch()` call. `EventSource`
 *    cannot set custom headers, so spans created by the upstream worker for
 *    each chat-message stream were orphaned (`parent=-`) — the end-to-end
 *    chain browser → web → worker → Copilot SDK could not be viewed as a
 *    single trace. Switching to `fetch()` closes that gap with no extra
 *    application code.
 * 2. **Reconnect with explicit policy.** The platform `EventSource` retries
 *    on a fixed schedule and refuses to surface "connection died" to user
 *    code; this client retries with capped-jitter exponential backoff, gives
 *    callers visibility into the reconnect state for UI hygiene, and exits
 *    on caller-controlled terminal frames.
 *
 * The wire-format parser is `eventsource-parser` (a zero-dependency library
 * used by the Vercel AI SDK). It handles UTF-8 chunk boundaries, multi-line
 * `data:` aggregation, CRLF, comment frames, and `id:`/`event:`/`retry:`
 * fields correctly.
 *
 * ## Lifecycle
 *
 * The caller owns an `AbortController`. To cancel a stream, call
 * `controller.abort()`. The client:
 *
 * - exits the read loop on the next chunk boundary;
 * - cancels any pending reconnect timer;
 * - returns silently (the consumer Promise resolves).
 *
 * Cleanup is synchronous from the caller's perspective: every React effect
 * can use the controller in its cleanup return without dealing with
 * Promise-returning APIs.
 *
 * ## Reconnect policy
 *
 * - Capped exponential backoff: 500ms → 1s → 2s → 4s → 8s → 15s → 30s,
 *   stays at 30s thereafter, plus `Math.random() * 1000` jitter.
 * - Wall-clock cap of 10 minutes. After that, the consumer Promise rejects
 *   so the caller can surface a user-visible error and evict the cursor.
 * - On a terminal frame (caller signals via `onMessage` returning
 *   `{ terminal: true }`), no further reconnect is scheduled.
 * - The URL used for each reconnect is recomputed via `buildUrl()` so the
 *   caller can read the latest cursor from a store instead of capturing it
 *   in a stale closure.
 */

import { createParser, type EventSourceMessage } from 'eventsource-parser';

/** Options for {@link consumeSSE}. */
export interface ConsumeSSEOptions {
  /**
   * Recomputed before every (re)connect. The caller typically composes
   * the URL with the current cursor from a cursor store so reconnect
   * requests pick up where the stream left off.
   */
  buildUrl: () => string;

  /** Owns the stream lifecycle; abort to cancel. */
  signal: AbortSignal;

  /**
   * Invoked for every parsed SSE event (after `id:` cursor update, before
   * any JSON parsing — that is the caller's responsibility). Return
   * `{ terminal: true }` to stop reconnection.
   *
   * Comment frames (lines starting with `:`) and `retry:` directives are
   * filtered by the parser and never reach this callback.
   */
  onMessage: (event: EventSourceMessage) => void | { terminal?: boolean };

  /**
   * Called whenever a reconnect is scheduled. The `attempt` value is
   * 1-indexed (first reconnect = 1). The caller may use this to surface
   * a "Reconnecting..." indicator after attempt N.
   */
  onReconnectScheduled?: (attempt: number, delayMs: number) => void;

  /**
   * Called once after the first successfully-parsed frame following a
   * reconnect. The caller may use this to clear a "Reconnecting..."
   * indicator. Not called on the initial connect (only after at least
   * one reconnect has occurred).
   */
  onReconnectRecovered?: () => void;

  /**
   * Called with a non-fatal warning when the parser surfaces an issue
   * (e.g. an unknown SSE field). Default: silently swallow.
   */
  onWarn?: (err: unknown) => void;

  /**
   * Maximum wall-clock duration (in ms) the client will keep reconnecting
   * before giving up. Default: 10 minutes.
   */
  maxReconnectDurationMs?: number;

  /**
   * Override timing for tests. In production these all default to real
   * `setTimeout`, `Date.now()`, and `Math.random()`.
   */
  setTimeoutImpl?: (cb: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  nowMs?: () => number;
  random?: () => number;

  /**
   * Override the global `fetch`. Default: `globalThis.fetch`. Provided
   * for tests; production code should not pass this.
   */
  fetchImpl?: typeof fetch;
}

/** Backoff schedule in ms (per attempt). Index N → attempt N+1. */
const BACKOFF_SCHEDULE_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
const DEFAULT_MAX_RECONNECT_DURATION_MS = 10 * 60 * 1_000;

function backoffForAttempt(attempt: number, random: () => number): number {
  const idx = Math.min(attempt - 1, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[idx]! + Math.floor(random() * 1_000);
}

/**
 * Sentinel thrown internally to break the loop when the caller signals
 * a terminal event. Never escapes to user code.
 */
class TerminalSignal {
  readonly terminal = true;
}

/**
 * Sentinel thrown internally when the upstream closed the body cleanly
 * without ever emitting a terminal frame. Triggers a reconnect via the
 * normal backoff path so the client matches `EventSource` semantics
 * (which auto-reconnects on any close that isn't an explicit protocol
 * completion). Never escapes to user code.
 */
class ConnectionClosedWithoutTerminalError extends Error {
  constructor() {
    super('SSE connection closed without terminal frame');
    this.name = 'ConnectionClosedWithoutTerminalError';
  }
}

/**
 * Error rejected from {@link consumeSSE} when reconnects exceed
 * {@link ConsumeSSEOptions.maxReconnectDurationMs}.
 */
export class SSEReconnectExhaustedError extends Error {
  constructor(durationMs: number) {
    super(`SSE reconnect exhausted after ${Math.round(durationMs / 1_000)}s of failed retries`);
    this.name = 'SSEReconnectExhaustedError';
  }
}

/**
 * Connects to an SSE endpoint and pumps parsed events to `onMessage`
 * until the caller aborts, signals a terminal event, or the reconnect
 * budget is exhausted.
 *
 * Resolves silently on abort or terminal. Rejects with
 * {@link SSEReconnectExhaustedError} on budget exhaustion. Never rejects
 * with `AbortError`.
 */
export async function consumeSSE(options: ConsumeSSEOptions): Promise<void> {
  const {
    buildUrl,
    signal,
    onMessage,
    onReconnectScheduled,
    onReconnectRecovered,
    onWarn,
    maxReconnectDurationMs = DEFAULT_MAX_RECONNECT_DURATION_MS,
    setTimeoutImpl = ((cb, ms) => globalThis.setTimeout(cb, ms)) as ConsumeSSEOptions['setTimeoutImpl'],
    clearTimeoutImpl = ((handle) =>
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)) as ConsumeSSEOptions['clearTimeoutImpl'],
    nowMs = (() => Date.now()) as ConsumeSSEOptions['nowMs'],
    random = (() => Math.random()) as ConsumeSSEOptions['random'],
    fetchImpl = globalThis.fetch.bind(globalThis),
  } = options;

  // Defensive: callers should never invoke this with an already-aborted
  // controller, but if they do, exit immediately.
  if (signal.aborted) return;

  const reconnectStartMs = nowMs!();
  let attempt = 0;
  let hasReconnected = false;
  let recoveredThisConnect = false;

  // Outer loop = one iteration per (re)connect.
  while (true) {
    let signalledTerminal = false;
    try {
      recoveredThisConnect = false;
      await runOneConnection({
        url: buildUrl(),
        signal,
        fetchImpl: fetchImpl!,
        onParsedEvent: (event) => {
          // Surface recovery callback once per reconnect on the first
          // successful frame (avoids "Connected → Reconnecting" flicker
          // when the handshake succeeds but the upstream then drops).
          if (hasReconnected && !recoveredThisConnect) {
            recoveredThisConnect = true;
            onReconnectRecovered?.();
          }
          let result: void | { terminal?: boolean };
          try {
            result = onMessage(event);
          } catch (err) {
            // Caller-supplied `onMessage` threw. Surface via `onWarn` and
            // skip this frame rather than tearing down the connection and
            // triggering a reconnect — a bug in the caller (e.g. JSON
            // parse error on a malformed frame) must not cause an
            // unbounded reconnect loop that exhausts the 10-minute wall
            // clock budget for no reason.
            onWarn?.(err);
            return;
          }
          if (result?.terminal) {
            signalledTerminal = true;
            throw new TerminalSignal();
          }
        },
        onWarn,
      });
      // Stream closed cleanly **without** a terminal signal. This is not a
      // legitimate completion — a terminal frame would have thrown
      // `TerminalSignal` above. Treat clean EOF the same as a network
      // error and reconnect with backoff, matching `EventSource` semantics
      // (which auto-reconnects on any disconnect that did not exit via a
      // protocol-level "done" message). This covers reverse-proxy idle
      // timeouts, load-balancer half-closes, and Cloudflare-style HTTP/2
      // hop terminations that don't surface as fetch errors.
      throw new ConnectionClosedWithoutTerminalError();
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof TerminalSignal || signalledTerminal) return;

      // Reconnect on any other failure (network error, non-2xx, broken
      // body). Exponential backoff with jitter, capped at 30s.
      attempt += 1;
      const elapsed = nowMs!() - reconnectStartMs;
      if (elapsed >= maxReconnectDurationMs) {
        throw new SSEReconnectExhaustedError(elapsed);
      }

      const delay = backoffForAttempt(attempt, random!);
      onReconnectScheduled?.(attempt, delay);
      hasReconnected = true;

      const aborted = await sleepWithAbort(delay, signal, setTimeoutImpl!, clearTimeoutImpl!);
      if (aborted) return;
    }
  }
}

interface RunOneConnectionParams {
  url: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  onParsedEvent: (event: EventSourceMessage) => void;
  onWarn?: (err: unknown) => void;
}

async function runOneConnection(params: RunOneConnectionParams): Promise<void> {
  const { url, signal, fetchImpl, onParsedEvent, onWarn } = params;

  const response = await fetchImpl(url, {
    signal,
    credentials: 'same-origin',
    headers: { Accept: 'text/event-stream' },
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`SSE handshake failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    throw new Error(`SSE handshake returned unexpected content-type: ${contentType}`);
  }
  if (!response.body) {
    throw new Error('SSE handshake returned an empty body');
  }

  const parser = createParser({
    onEvent: onParsedEvent,
    onError: (err) => onWarn?.(err),
  });

  // Older Safari + jsdom test envs lack `TextDecoderStream`, so we
  // decode manually. `stream: true` correctly handles multi-byte UTF-8
  // codepoints split across chunks.
  const decoder = new TextDecoder('utf-8');
  const reader = response.body.getReader();

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        parser.feed(decoder.decode());
        return;
      }
      parser.feed(decoder.decode(value, { stream: true }));
    }
  } finally {
    // Cancel the underlying body before releasing the lock. `cancel()`
    // signals the network layer to stop buffering chunks (important when
    // exiting via TerminalSignal, where the connection would otherwise
    // linger until GC); `releaseLock()` then detaches the reader. Errors
    // are ignored — the stream may already be cancelled via the
    // AbortController, in which case both calls are no-ops that may
    // throw.
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function sleepWithAbort(
  ms: number,
  signal: AbortSignal,
  setTimeoutImpl: NonNullable<ConsumeSSEOptions['setTimeoutImpl']>,
  clearTimeoutImpl: NonNullable<ConsumeSSEOptions['clearTimeoutImpl']>,
): Promise<boolean> {
  if (signal.aborted) return true;
  return new Promise<boolean>((resolve) => {
    const handle = setTimeoutImpl(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(false);
    }, ms);
    const onAbort = (): void => {
      clearTimeoutImpl(handle);
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
