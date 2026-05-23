/**
 * Tests for the F5 useRateLimitCountdown hook.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMITED_EVENT,
  type RateLimitedEventDetail,
} from '@/lib/api/rate-limit-event';

import { useRateLimitCountdown } from './use-rate-limit-countdown';

function dispatch(detail: RateLimitedEventDetail) {
  window.dispatchEvent(new CustomEvent(RATE_LIMITED_EVENT, { detail }));
}

describe('useRateLimitCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in an enabled state', () => {
    const { result } = renderHook(() => useRateLimitCountdown());
    expect(result.current.disabled).toBe(false);
    expect(result.current.retryInSeconds).toBeNull();
    expect(result.current.reason).toBeNull();
  });

  it('disables while a cooldown is active and ticks down', () => {
    const { result } = renderHook(() => useRateLimitCountdown());

    act(() => {
      dispatch({ reason: 'rate_limit', retryAfterSeconds: 3 });
    });

    expect(result.current.disabled).toBe(true);
    expect(result.current.retryInSeconds).toBe(3);
    expect(result.current.reason).toBe('rate_limit');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.retryInSeconds).toBe(2);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.retryInSeconds).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.disabled).toBe(false);
    expect(result.current.retryInSeconds).toBeNull();
    expect(result.current.reason).toBeNull();
  });

  it('keeps the longer cooldown when two events arrive', () => {
    const { result } = renderHook(() => useRateLimitCountdown());

    act(() => {
      dispatch({ reason: 'rate_limit', retryAfterSeconds: 2 });
      dispatch({ reason: 'rate_limit', retryAfterSeconds: 10 });
    });

    expect(result.current.retryInSeconds).toBe(10);
  });

  it('exposes the session_cap reason', () => {
    const { result } = renderHook(() => useRateLimitCountdown());

    act(() => {
      dispatch({ reason: 'session_cap', retryAfterSeconds: 30, max: 3 });
    });

    expect(result.current.disabled).toBe(true);
    expect(result.current.reason).toBe('session_cap');
  });
});
