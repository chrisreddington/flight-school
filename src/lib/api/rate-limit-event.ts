/**
 * Shared client-side primitives for the F5 "rate-limited" UI signal.
 *
 * The server emits HTTP 429 from two distinct sources:
 *
 * - `rate_limit`  — per-user sliding-window rate limit (see
 *   `src/lib/security/rate-limit.ts`). User must wait.
 * - `session_cap` — concurrent Copilot-session cap (see
 *   `src/lib/security/session-cap.ts`). User must finish or cancel an
 *   in-flight session before starting a new one.
 *
 * Both surface as a 429 with a `X-RateLimit-Reason` header and a `reason`
 * field in the JSON body so the client can render the right copy.
 *
 * This module lives under `src/lib/api/` so both the fetch wrapper
 * (`src/lib/api-client.ts`) and the React UI (toast, hook) can import
 * without dragging server code or React in.
 */

/** Window event dispatched when any client API call observes a 429. */
export const RATE_LIMITED_EVENT = 'rate-limited';

/** Discriminator for the two 429 sources the server emits. */
export type RateLimitReason = 'rate_limit' | 'session_cap';

/** Payload of a `rate-limited` CustomEvent. */
export interface RateLimitedEventDetail {
  /** Why the server returned 429. */
  reason: RateLimitReason;
  /**
   * Seconds the client should wait before retrying. Parsed from the
   * `Retry-After` response header (delta-seconds *or* HTTP-date per
   * RFC 7231 §7.1.3), falling back to 30 when the header is absent or
   * unparseable.
   */
  retryAfterSeconds: number;
  /** Originating endpoint. For telemetry only. */
  route?: string;
  /**
   * Concurrent-session cap (only present when `reason === 'session_cap'`).
   * Lifted from the 429 response body so the toast can render
   * "limit of N concurrent sessions" with the right number.
   */
  max?: number;
}

/** Default Retry-After when the server omits the header. */
export const DEFAULT_RETRY_AFTER_SECONDS = 30;

/** Header the server sets to distinguish rate-limit vs session-cap. */
const RATE_LIMIT_REASON_HEADER = 'X-RateLimit-Reason';

/**
 * Error thrown by the client fetch helper when the server returns 429.
 * Catch this in a per-call site to (for example) avoid logging the error
 * — the toast and `useRateLimitCountdown` already handle the user-facing UX.
 */
export class RateLimitedClientError extends Error {
  readonly status = 429;
  readonly reason: RateLimitReason;
  readonly retryAfterSeconds: number;
  readonly max?: number;

  constructor(detail: RateLimitedEventDetail) {
    super(
      detail.reason === 'session_cap'
        ? `Concurrent session limit reached${detail.max ? ` (max ${detail.max})` : ''}.`
        : `Rate limit exceeded. Retry after ${detail.retryAfterSeconds}s.`,
    );
    this.name = 'RateLimitedClientError';
    this.reason = detail.reason;
    this.retryAfterSeconds = detail.retryAfterSeconds;
    this.max = detail.max;
  }
}

/**
 * Parse an HTTP `Retry-After` header value into seconds.
 * Accepts delta-seconds (integer string) or an HTTP-date string per
 * RFC 7231 §7.1.3. Returns {@link DEFAULT_RETRY_AFTER_SECONDS} when the
 * value is missing, malformed, or in the past.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number {
  if (!value) return DEFAULT_RETRY_AFTER_SECONDS;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_RETRY_AFTER_SECONDS;

  // delta-seconds: a non-negative integer
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
  }

  // HTTP-date
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const seconds = Math.ceil((dateMs - now) / 1000);
    return seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
  }

  return DEFAULT_RETRY_AFTER_SECONDS;
}

/**
 * Look at a parsed 429 response and dispatch the `rate-limited` event.
 * Idempotent: callers can invoke this from any fetch site, including
 * raw `fetch` callers that don't go through `apiPost`/`apiGet`.
 *
 * @returns The dispatched detail, so the caller can also throw a typed
 *   {@link RateLimitedClientError} if it wants per-call handling.
 */
export function dispatchRateLimited(response: Response, body: unknown, route?: string): RateLimitedEventDetail {
  const headerReason = response.headers.get(RATE_LIMIT_REASON_HEADER);
  const bodyReason =
    body && typeof body === 'object' && 'reason' in body ? (body as { reason?: unknown }).reason : undefined;
  const reason: RateLimitReason =
    headerReason === 'session_cap' || bodyReason === 'session_cap' ? 'session_cap' : 'rate_limit';

  const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
  const max =
    body && typeof body === 'object' && typeof (body as { max?: unknown }).max === 'number'
      ? (body as { max: number }).max
      : undefined;

  const detail: RateLimitedEventDetail = {
    reason,
    retryAfterSeconds,
    route,
    max,
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(RATE_LIMITED_EVENT, { detail }));
  }

  return detail;
}
