/**
 * Tests for the F5 rate-limit event utilities.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRY_AFTER_SECONDS,
  RATE_LIMITED_EVENT,
  RateLimitedClientError,
  dispatchRateLimited,
  parseRetryAfter,
  type RateLimitedEventDetail,
} from './rate-limit-event';

describe('parseRetryAfter', () => {
  it('returns the default when value is missing', () => {
    expect(parseRetryAfter(null)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(parseRetryAfter(undefined)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
    expect(parseRetryAfter('')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('parses delta-seconds integers', () => {
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('120')).toBe(120);
  });

  it('falls back to the default for zero or negative deltas', () => {
    expect(parseRetryAfter('0')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('parses HTTP-date values', () => {
    const now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const future = new Date(now + 45_000).toUTCString();
    expect(parseRetryAfter(future, now)).toBeGreaterThanOrEqual(44);
    expect(parseRetryAfter(future, now)).toBeLessThanOrEqual(46);
  });

  it('falls back for past HTTP-date values', () => {
    const now = Date.UTC(2024, 0, 1, 0, 0, 0);
    const past = new Date(now - 60_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });

  it('falls back for unparseable values', () => {
    expect(parseRetryAfter('not-a-number')).toBe(DEFAULT_RETRY_AFTER_SECONDS);
  });
});

describe('dispatchRateLimited', () => {
  let received: RateLimitedEventDetail | null = null;
  const listener = (event: Event) => {
    received = (event as CustomEvent<RateLimitedEventDetail>).detail;
  };

  beforeEach(() => {
    received = null;
    window.addEventListener(RATE_LIMITED_EVENT, listener);
  });

  afterEach(() => {
    window.removeEventListener(RATE_LIMITED_EVENT, listener);
  });

  function makeResponse(headers: Record<string, string>): Response {
    return new Response(null, { status: 429, headers });
  }

  it('reads the rate_limit reason from X-RateLimit-Reason', () => {
    const response = makeResponse({
      'Retry-After': '12',
      'X-RateLimit-Reason': 'rate_limit',
    });
    const detail = dispatchRateLimited(response, {}, '/api/test');
    expect(detail.reason).toBe('rate_limit');
    expect(detail.retryAfterSeconds).toBe(12);
    expect(detail.route).toBe('/api/test');
    expect(received).toEqual(detail);
  });

  it('reads the session_cap reason and max from the body', () => {
    const response = makeResponse({
      'X-RateLimit-Reason': 'session_cap',
      'Retry-After': '30',
    });
    const detail = dispatchRateLimited(
      response,
      { reason: 'session_cap', max: 3 },
      '/api/jobs',
    );
    expect(detail.reason).toBe('session_cap');
    expect(detail.max).toBe(3);
    expect(received?.reason).toBe('session_cap');
    expect(received?.max).toBe(3);
  });

  it('defaults to rate_limit when no reason header/body present', () => {
    const response = makeResponse({ 'Retry-After': '5' });
    const detail = dispatchRateLimited(response, {});
    expect(detail.reason).toBe('rate_limit');
  });
});

describe('RateLimitedClientError', () => {
  it('formats a rate_limit message', () => {
    const err = new RateLimitedClientError({
      reason: 'rate_limit',
      retryAfterSeconds: 20,
    });
    expect(err.status).toBe(429);
    expect(err.reason).toBe('rate_limit');
    expect(err.retryAfterSeconds).toBe(20);
    expect(err.message).toContain('20s');
  });

  it('formats a session_cap message with max', () => {
    const err = new RateLimitedClientError({
      reason: 'session_cap',
      retryAfterSeconds: 30,
      max: 3,
    });
    expect(err.reason).toBe('session_cap');
    expect(err.max).toBe(3);
    expect(err.message).toContain('max 3');
  });
});
