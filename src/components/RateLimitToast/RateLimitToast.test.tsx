/**
 * Tests for the F5 RateLimitToast component.
 */

import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@primer/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RATE_LIMITED_EVENT,
  type RateLimitedEventDetail,
} from '@/lib/api/rate-limit-event';

import { RateLimitToast } from './index';

function dispatch(detail: RateLimitedEventDetail) {
  window.dispatchEvent(new CustomEvent(RATE_LIMITED_EVENT, { detail }));
}

function renderToast() {
  return render(
    <ThemeProvider colorMode="day">
      <RateLimitToast />
    </ThemeProvider>,
  );
}

describe('RateLimitToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing by default', () => {
    renderToast();
    expect(screen.queryByTestId('rate-limit-toast')).toBeNull();
  });

  it('shows rate_limit copy with a countdown and auto-dismisses', () => {
    renderToast();

    act(() => {
      dispatch({ reason: 'rate_limit', retryAfterSeconds: 3 });
    });

    const toast = screen.getByTestId('rate-limit-toast');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast.textContent).toContain('Too many requests');
    expect(toast.textContent).toContain('3s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('rate-limit-toast').textContent).toContain('2s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('rate-limit-toast').textContent).toContain('1s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('rate-limit-toast')).toBeNull();
  });

  it('shows session_cap copy with the configured max and no countdown', () => {
    renderToast();

    act(() => {
      dispatch({ reason: 'session_cap', retryAfterSeconds: 30, max: 3 });
    });

    const toast = screen.getByTestId('rate-limit-toast');
    expect(toast.textContent).toContain('concurrent AI sessions');
    expect(toast.textContent).toContain('(3)');
    expect(toast.textContent).toContain('Finish or cancel');

    // session_cap shouldn't auto-dismiss with the per-second tick
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId('rate-limit-toast')).toBeInTheDocument();

    // but does auto-dismiss after 30s
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByTestId('rate-limit-toast')).toBeNull();
  });
});
