/**
 * Map a thrown guard error into a Web-standard `Response`.
 *
 * Returns `Response` (not `NextResponse`) so this helper is reachable
 * from both Next.js route handlers and the worker's Hono handlers
 * without pulling `next/server` into the worker import graph.
 */

import { UnauthorizedError } from '@/lib/auth/context';
import { copilotEntitlementErrorResponse } from '@/lib/copilot/entitlement-http';
import { RateLimitedError } from '@/lib/security/rate-limit';
import { TooManyConcurrentSessionsError } from '@/lib/security/session-cap';

/**
 * Convert a `withUserGuards` error to a JSON response. Returns `null` for
 * unrelated errors so the caller can apply its own handling.
 */
export function guardErrorResponse(error: unknown): Response | null {
  // P5: Copilot entitlement failures → 402 Payment Required.
  // Checked first so a missing-license 402 takes precedence over any
  // generic 500 the route would otherwise produce.
  const entitlementResponse = copilotEntitlementErrorResponse(error);
  if (entitlementResponse) return entitlementResponse;

  if (error instanceof RateLimitedError) {
    const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return Response.json(
      {
        error: error.message,
        code: error.code,
        reason: 'rate_limit',
        retryAfterMs: error.retryAfterMs,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Reason': 'rate_limit',
        },
      },
    );
  }
  if (error instanceof TooManyConcurrentSessionsError) {
    return Response.json(
      {
        error: error.message,
        code: error.code,
        reason: 'session_cap',
        max: error.max,
      },
      {
        status: 429,
        headers: {
          'Retry-After': '30',
          'X-RateLimit-Reason': 'session_cap',
        },
      },
    );
  }
  if (error instanceof UnauthorizedError) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  return null;
}
