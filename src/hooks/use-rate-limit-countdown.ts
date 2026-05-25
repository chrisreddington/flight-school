'use client';

/**
 * useRateLimitCountdown
 *
 * React hook for AI-trigger buttons. Listens for the global
 * `rate-limited` event dispatched by `src/lib/api-client.ts` and returns
 * `{ disabled, retryInSeconds, reason }` so a button can render
 * "Retry in 23s" and stay disabled until the cooldown elapses.
 *
 * @example
 * ```tsx
 * const { disabled, retryInSeconds } = useRateLimitCountdown();
 * <Button disabled={disabled} onClick={onTrigger}>
 *   {disabled ? `Retry in ${retryInSeconds}s` : 'Regenerate focus'}
 * </Button>
 * ```
 *
 * @remarks
 * For `reason === 'session_cap'`, retry isn't time-based — the user must
 * finish or cancel an in-flight AI session. The hook still surfaces a
 * 30-second disable window so a rapid second click doesn't immediately
 * re-trigger; the toast guides the user to the real action.
 */

import { useEffect, useState } from 'react';

import { RATE_LIMITED_EVENT, type RateLimitedEventDetail, type RateLimitReason } from '@/lib/api/rate-limit-event';

export interface UseRateLimitCountdownResult {
  /** True while a cooldown is active. */
  disabled: boolean;
  /** Remaining seconds in the current cooldown, or null when none. */
  retryInSeconds: number | null;
  /** Source of the cooldown, or null when none. */
  reason: RateLimitReason | null;
}

interface CountdownState {
  retryInSeconds: number | null;
  reason: RateLimitReason | null;
}

const EMPTY_STATE: CountdownState = { retryInSeconds: null, reason: null };

export function useRateLimitCountdown(): UseRateLimitCountdownResult {
  const [state, setState] = useState<CountdownState>(EMPTY_STATE);

  useEffect(() => {
    function onRateLimited(event: Event) {
      const detail = (event as CustomEvent<RateLimitedEventDetail>).detail;
      if (!detail) return;
      setState((current) =>
        // Take the longest active cooldown if multiple events fire close together.
        current.retryInSeconds === null || detail.retryAfterSeconds > current.retryInSeconds
          ? { retryInSeconds: detail.retryAfterSeconds, reason: detail.reason }
          : current,
      );
    }
    window.addEventListener(RATE_LIMITED_EVENT, onRateLimited);
    return () => window.removeEventListener(RATE_LIMITED_EVENT, onRateLimited);
  }, []);

  useEffect(() => {
    if (state.retryInSeconds === null) return;
    const id = setTimeout(() => {
      setState((current) => {
        if (current.retryInSeconds === null) return current;
        if (current.retryInSeconds <= 1) return EMPTY_STATE;
        return { ...current, retryInSeconds: current.retryInSeconds - 1 };
      });
    }, 1000);
    return () => clearTimeout(id);
  }, [state.retryInSeconds]);

  return {
    disabled: state.retryInSeconds !== null && state.retryInSeconds > 0,
    retryInSeconds: state.retryInSeconds,
    reason: state.reason,
  };
}
