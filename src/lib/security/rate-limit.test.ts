import { afterEach, describe, expect, it, vi } from 'vitest';

import { __resetRateLimitState, checkRateLimit, RateLimitedError } from './rate-limit';

describe('checkRateLimit', () => {
  afterEach(() => {
    __resetRateLimitState();
    vi.useRealTimers();
  });

  it('allows requests up to the limit and blocks beyond it', () => {
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit('user-1', 3, 60_000).allowed).toBe(true);
    }
    const blocked = checkRateLimit('user-1', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('keeps counters independent per user', () => {
    for (let i = 0; i < 3; i += 1) {
      checkRateLimit('user-a', 3, 60_000);
    }
    expect(checkRateLimit('user-a', 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit('user-b', 3, 60_000).allowed).toBe(true);
  });

  it('slides the window so old timestamps eventually expire', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(true);
    }
    expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(false);

    vi.advanceTimersByTime(1_500);
    expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(true);
  });

  it('exposes RateLimitedError with retryAfterMs and 429 status', () => {
    const err = new RateLimitedError(2500);
    expect(err.status).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.retryAfterMs).toBe(2500);
  });
});
