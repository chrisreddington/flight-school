/**
 * Map a thrown guard error into a Next.js response.
 */

import { NextResponse } from 'next/server';

import { UnauthorizedError } from '@/lib/auth/context';
import { RateLimitedError } from '@/lib/security/rate-limit';
import { TooManyConcurrentSessionsError } from '@/lib/security/session-cap';

/**
 * Convert a `withUserGuards` error to a JSON response. Returns `null` for
 * unrelated errors so the caller can apply its own handling.
 */
export function guardErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof RateLimitedError) {
    const retryAfterSeconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    return NextResponse.json(
      { error: error.message, code: error.code, retryAfterMs: error.retryAfterMs },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    );
  }
  if (error instanceof TooManyConcurrentSessionsError) {
    return NextResponse.json(
      { error: error.message, code: error.code, max: error.max },
      { status: 429 },
    );
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  return null;
}
