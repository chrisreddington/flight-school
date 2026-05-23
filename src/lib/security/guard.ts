/**
 * Per-user guard composition for API routes.
 *
 * `withUserGuards` is the standard wrapper for any expensive (AI-backed)
 * API route. It resolves the authenticated user, enforces a sliding-window
 * rate limit, acquires a concurrent-session slot, and emits an audit event
 * for the operation.
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   return withUserGuards(
 *     { rateLimit: { limit: 10, windowMs: 60_000 }, concurrentCap: 2, eventType: 'copilot.session.create' },
 *     async ({ userId }) => {
 *       // ...do the work...
 *       return NextResponse.json({ ok: true });
 *     },
 *   );
 * }
 * ```
 */

import 'server-only';

import { requireUserContext, type UserContext } from '@/lib/auth/context';
import { auditLog, hashUserId, type AuditEventType } from '@/lib/security/audit';
import { checkRateLimit, RateLimitedError } from '@/lib/security/rate-limit';
import { acquireSlot } from '@/lib/security/session-cap';

export interface GuardOptions {
  /** Sliding-window rate limit. Skip the field to disable rate limiting. */
  rateLimit?: { limit: number; windowMs: number };
  /** Max in-flight sessions per user. Skip the field to disable. */
  concurrentCap?: number;
  /** Audit event type to emit on entry. */
  eventType: AuditEventType;
  /** Extra metadata recorded on the audit event. */
  auditMetadata?: Record<string, unknown>;
}

/**
 * Apply auth + rate-limit + concurrent-cap + audit logging around `work`.
 *
 * @throws {@link RateLimitedError} when the user is over the rate limit.
 * @throws {@link TooManyConcurrentSessionsError} when the user is over the
 *   concurrent-session cap.
 * @throws {@link UnauthorizedError} when the request is unauthenticated.
 */
export async function withUserGuards<T>(
  opts: GuardOptions,
  work: (ctx: UserContext) => Promise<T>,
): Promise<T> {
  const ctx = await requireUserContext();
  const userIdHash = hashUserId(ctx.userId);

  if (opts.rateLimit) {
    const { allowed, retryAfterMs } = checkRateLimit(
      ctx.userId,
      opts.rateLimit.limit,
      opts.rateLimit.windowMs,
    );
    if (!allowed) {
      auditLog({
        type: 'rate-limit.blocked',
        userIdHash,
        metadata: { eventType: opts.eventType, retryAfterMs },
      });
      throw new RateLimitedError(retryAfterMs ?? opts.rateLimit.windowMs);
    }
  }

  let release: (() => void) | null = null;
  if (opts.concurrentCap !== undefined) {
    try {
      release = await acquireSlot(ctx.userId, opts.concurrentCap);
    } catch (err) {
      auditLog({
        type: 'session-cap.blocked',
        userIdHash,
        metadata: { eventType: opts.eventType, max: opts.concurrentCap },
      });
      throw err;
    }
  }

  auditLog({
    type: opts.eventType,
    userIdHash,
    metadata: opts.auditMetadata,
  });

  try {
    return await work(ctx);
  } finally {
    release?.();
  }
}
