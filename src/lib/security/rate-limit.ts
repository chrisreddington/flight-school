/**
 * Per-user sliding-window rate limiter.
 *
 * Tracks request timestamps per user in an in-memory map and enforces a
 * "no more than `limit` requests in any `windowMs` window" policy.
 *
 * @remarks
 * **Per-replica only.** This implementation keeps state in process memory,
 * so behind a load balancer each replica enforces its own counter. For
 * truly global rate limits (e.g. shared between Container Apps replicas)
 * back this with Redis or a managed token-bucket service. The function
 * signature is intentionally synchronous-friendly so a Redis implementation
 * can drop in behind it.
 */

const buckets = new Map<string, number[]>();

export interface RateLimitResult {
  /** Whether the request is allowed under the current window. */
  allowed: boolean;
  /** Milliseconds the caller should wait before retrying. Only present when blocked. */
  retryAfterMs?: number;
}

/**
 * Error thrown by {@link withUserGuards} when a request exceeds the per-user
 * rate limit. The HTTP layer translates this into a 429 response with a
 * `Retry-After` header.
 */
export class RateLimitedError extends Error {
  readonly status = 429;
  readonly code = 'RATE_LIMITED' as const;
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterMs}ms.`);
    this.name = 'RateLimitedError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Check whether a user may make another request inside the sliding window.
 * Records the timestamp when allowed; the next call sees this request in
 * its window.
 *
 * @param userId - Stable user identifier (e.g. GitHub numeric ID).
 * @param limit - Max number of requests permitted within `windowMs`.
 * @param windowMs - Length of the sliding window in milliseconds.
 */
export function checkRateLimit(
  userId: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const nowTs = Date.now();
  const cutoff = nowTs - windowMs;

  const existing = buckets.get(userId);
  const recent = existing ? existing.filter((ts) => ts > cutoff) : [];

  if (recent.length >= limit) {
    const oldest = recent[0];
    const retryAfterMs = Math.max(1, oldest + windowMs - nowTs);
    buckets.set(userId, recent);
    return { allowed: false, retryAfterMs };
  }

  recent.push(nowTs);
  buckets.set(userId, recent);

  if (buckets.size > 1000) {
    cleanupExpired(cutoff);
  }

  return { allowed: true };
}

function cleanupExpired(cutoff: number) {
  for (const [key, timestamps] of buckets) {
    const fresh = timestamps.filter((ts) => ts > cutoff);
    if (fresh.length === 0) {
      buckets.delete(key);
    } else if (fresh.length !== timestamps.length) {
      buckets.set(key, fresh);
    }
  }
}

/**
 * Test-only helper to reset all in-memory state between test cases.
 *
 * @internal
 */
export function __resetRateLimitState() {
  buckets.clear();
}
