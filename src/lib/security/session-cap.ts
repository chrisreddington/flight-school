/**
 * Per-user concurrent-session cap.
 *
 * Tracks the number of in-flight expensive operations (e.g. Copilot SDK
 * sessions) per user so a single user can't tie up all the AI capacity
 * with many parallel requests.
 *
 * @remarks
 * **Per-replica only.** Counter lives in process memory. Replace with a
 * Redis INCR/DECR pair (with TTL fallback for crashed releases) if global
 * enforcement is needed.
 */

const inflight = new Map<string, number>();

/**
 * Error thrown by {@link withUserGuards} when a user has too many parallel
 * sessions in flight. Translated by the HTTP layer into a 429.
 */
export class TooManyConcurrentSessionsError extends Error {
  readonly status = 429;
  readonly code = 'CONCURRENT_SESSION_LIMIT' as const;
  readonly max: number;

  constructor(max: number) {
    super(`Too many concurrent sessions (max ${max}).`);
    this.name = 'TooManyConcurrentSessionsError';
    this.max = max;
  }
}

/**
 * Acquire a concurrency slot for `userId`.
 *
 * @param userId - Stable user identifier.
 * @param max - Maximum simultaneous slots permitted for the user.
 * @returns A release function. Call it (typically in a `finally` block)
 *   exactly once when the work completes; subsequent calls are no-ops, so
 *   it is safe to release even if the caller is unsure whether work ran.
 * @throws {@link TooManyConcurrentSessionsError} when the user already
 *   holds `max` slots in flight.
 */
export async function acquireSlot(userId: string, max: number): Promise<() => void> {
  const current = inflight.get(userId) ?? 0;
  if (current >= max) {
    throw new TooManyConcurrentSessionsError(max);
  }
  inflight.set(userId, current + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (inflight.get(userId) ?? 1) - 1;
    if (next <= 0) {
      inflight.delete(userId);
    } else {
      inflight.set(userId, next);
    }
  };
}

/**
 * Inspect the current slot count. Exposed for tests / diagnostics.
 *
 * @internal
 */
export function __getSlotCount(userId: string): number {
  return inflight.get(userId) ?? 0;
}

/**
 * Test-only helper to reset all in-memory state between test cases.
 *
 * @internal
 */
export function __resetSessionCapState() {
  inflight.clear();
}
