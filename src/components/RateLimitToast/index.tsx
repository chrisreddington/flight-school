'use client';

/**
 * RateLimitToast (F5)
 *
 * Global toast surfaced when an API call observes HTTP 429. Two flavours:
 *
 * - `rate_limit`  — countdown copy that ticks down to zero, then auto-dismisses.
 * - `session_cap` — action-required copy with no countdown; auto-dismisses
 *   after 30 s (the user needs to finish or cancel an AI session before
 *   another can start).
 *
 * Mounted once in {@link Providers} so every route benefits without per-page
 * wiring — the toast listens for the `rate-limited` window event dispatched
 * by `src/lib/api-client.ts`.
 *
 * Accessibility:
 *  - `aria-live="assertive"` so screen readers announce immediately.
 *  - `role="status"` keeps it a non-modal live region.
 */

import { XIcon } from '@primer/octicons-react';
import { Flash, IconButton } from '@primer/react';
import { useEffect, useState } from 'react';

import {
  RATE_LIMITED_EVENT,
  type RateLimitedEventDetail,
} from '@/lib/api/rate-limit-event';

import styles from './RateLimitToast.module.css';

/** Auto-dismiss timeout for the action-required session-cap variant. */
const SESSION_CAP_AUTO_DISMISS_MS = 30_000;

export function RateLimitToast() {
  const [detail, setDetail] = useState<RateLimitedEventDetail | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  // Subscribe to rate-limited events.
  useEffect(() => {
    function onRateLimited(event: Event) {
      const next = (event as CustomEvent<RateLimitedEventDetail>).detail;
      if (!next) return;
      setDetail(next);
      setSecondsRemaining(
        next.reason === 'rate_limit' ? next.retryAfterSeconds : null,
      );
    }
    window.addEventListener(RATE_LIMITED_EVENT, onRateLimited);
    return () => window.removeEventListener(RATE_LIMITED_EVENT, onRateLimited);
  }, []);

  // Countdown ticker for the rate_limit variant.
  useEffect(() => {
    if (secondsRemaining === null) return;
    const id = setTimeout(() => {
      setSecondsRemaining((current) => {
        if (current === null) return current;
        if (current <= 1) {
          setDetail(null);
          return null;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearTimeout(id);
  }, [secondsRemaining]);

  // Auto-dismiss the action-required session-cap variant after 30 s.
  useEffect(() => {
    if (!detail || detail.reason !== 'session_cap') return;
    const id = setTimeout(() => {
      setDetail(null);
    }, SESSION_CAP_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [detail]);

  if (!detail) return null;

  const variant = detail.reason === 'session_cap' ? 'warning' : 'default';
  const message =
    detail.reason === 'session_cap'
      ? `You've hit the limit of concurrent AI sessions${detail.max ? ` (${detail.max})` : ''}. Finish or cancel one before starting another.`
      : `Too many requests right now. Please wait ${secondsRemaining ?? detail.retryAfterSeconds}s before trying again.`;

  return (
    <div
      className={styles.toastContainer}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="rate-limit-toast"
    >
      <Flash variant={variant} className={styles.toast}>
        <span className={styles.message}>{message}</span>
        <IconButton
          icon={XIcon}
          aria-label="Dismiss notification"
          variant="invisible"
          size="small"
          onClick={() => setDetail(null)}
          className={styles.dismiss}
        />
      </Flash>
    </div>
  );
}

export default RateLimitToast;
