/**
 * Per-user guards for any expensive (AI-backed) call site.
 *
 * Two entry points:
 *
 * - {@link requireGuardedUserContext} — the reusable async core. Resolves
 *   the authenticated user, enforces rate limit + concurrent-session cap,
 *   emits the audit event, and returns the `UserContext` plus a `release`
 *   function the caller must call when the work is done. Use this from
 *   Server Actions, RSC data loaders, and any other non-route call site
 *   that should share the same security policy as route handlers.
 *
 * - {@link withUserGuards} — a thin adapter that wraps the core for the
 *   common API-route pattern (`return await withUserGuards(opts, work)`).
 *   Handles `release` automatically.
 *
 * @example Route handler
 * ```ts
 * export async function POST(request: NextRequest) {
 *   return withUserGuards(
 *     { ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { route: '/api/focus' } },
 *     async (ctx) => NextResponse.json(await doWork(ctx)),
 *   );
 * }
 * ```
 *
 * @example Server Action
 * ```ts
 * 'use server';
 * export async function refreshFocusAction() {
 *   const { ctx, release } = await requireGuardedUserContext({
 *     ...FOCUS_GUARD, eventType: 'copilot.session.create', auditMetadata: { action: 'refreshFocus' },
 *   });
 *   try {
 *     return await doWork(ctx);
 *   } finally {
 *     release();
 *   }
 * }
 * ```
 */

import 'server-only';

import { requireUserContext, UnauthorizedError, type UserContext } from '@/lib/auth/context';
import { auditLog, hashUserId, type AuditEventType } from '@/lib/security/audit';
import { guardErrorResponse } from '@/lib/security/http';
import { checkRateLimit, RateLimitedError } from '@/lib/security/rate-limit';
import { acquireSlot } from '@/lib/security/session-cap';
import type { NextResponse } from 'next/server';

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

/** Result of {@link requireGuardedUserContext}. */
export interface GuardedContext {
  ctx: UserContext;
  /**
   * Release any concurrent-session slot acquired by the guard. Always
   * call this from a `finally` block — even if `concurrentCap` was not
   * set, calling `release` is safe (no-op).
   */
  release: () => void;
}

/**
 * Resolve the authenticated user and apply the guard policy. Returns the
 * `UserContext` plus a `release` handle the caller MUST invoke when the
 * guarded work finishes (success or failure). The audit event is emitted
 * once the user has cleared rate-limit and session-cap checks.
 *
 * @throws {@link RateLimitedError} when the user is over the rate limit.
 * @throws {@link TooManyConcurrentSessionsError} when over the cap.
 * @throws {@link UnauthorizedError} when the request is unauthenticated.
 */
export async function requireGuardedUserContext(opts: GuardOptions): Promise<GuardedContext> {
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

  auditLog({ type: opts.eventType, userIdHash, metadata: opts.auditMetadata });

  return {
    ctx,
    release: () => {
      release?.();
      release = null;
    },
  };
}

/**
 * Apply the guard policy and invoke `work`. Wraps
 * {@link requireGuardedUserContext} so route handlers don't have to manage
 * `release` themselves.
 */
export async function withUserGuards<T>(
  opts: GuardOptions,
  work: (ctx: UserContext) => Promise<T>,
): Promise<T> {
  const { ctx, release } = await requireGuardedUserContext(opts);
  try {
    return await work(ctx);
  } finally {
    release();
  }
}

/**
 * Route adapter that combines {@link withUserGuards} with the standard
 * guard-error mapping. Every authenticated AI route should use this
 * instead of hand-rolling the `try { withUserGuards } catch
 * (guardErrorResponse)` pattern.
 *
 * Unknown errors are re-thrown so Next.js renders the framework 500 —
 * routes that need a custom fallback should still catch inside `work`
 * (see e.g. quiz/route.ts where `knownApiErrorResponse` runs ahead of
 * the static fallback to preserve paying-customer 402s).
 */
export async function withGuardedRoute<R extends Response>(
  opts: GuardOptions,
  work: (ctx: UserContext) => Promise<R>,
): Promise<R | NextResponse> {
  try {
    return await withUserGuards(opts, work);
  } catch (error) {
    const response = guardErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

/**
 * RSC page adapter. Resolves the authenticated user and emits the audit
 * event for a read-only page view. Server Components don't need
 * concurrent-session caps or rate limits, so we short-circuit those
 * fields and release immediately.
 *
 * Returns `null` when there is no signed-in user, so the caller can
 * issue a `redirect()` to the sign-in page (Next.js does not allow
 * `redirect()` to be called from inside a `try`/`catch`).
 */
export async function requireGuardedRscContext(
  eventType: AuditEventType,
): Promise<UserContext | null> {
  try {
    const { ctx, release } = await requireGuardedUserContext({ eventType });
    release();
    return ctx;
  } catch (error) {
    if (error instanceof UnauthorizedError) return null;
    throw error;
  }
}
