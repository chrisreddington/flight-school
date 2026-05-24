import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetRouteTrackingForTests,
  endCurrentPageView,
  getCurrentPageView,
  installRouteTracking,
  startPageView,
} from './route-tracking';

const mocks = vi.hoisted(() => ({
  startSpan: vi.fn(),
  end: vi.fn(),
  setAttribute: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: () => ({
      startSpan: (name: string, opts: unknown) => {
        mocks.startSpan(name, opts);
        return {
          end: () => mocks.end(),
          setAttribute: (k: string, v: unknown) => mocks.setAttribute(k, v),
          spanContext: () => ({ traceId: 't', spanId: 's' }),
        };
      },
    }),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  __resetRouteTrackingForTests();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  __resetRouteTrackingForTests();
});

describe('startPageView', () => {
  it('creates a page.view span with the path attribute', () => {
    startPageView('/dashboard');

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'page.view',
      expect.objectContaining({
        attributes: expect.objectContaining({ 'page.path': '/dashboard' }),
      }),
    );
  });

  it('attaches the previous path on subsequent transitions', () => {
    startPageView('/a');
    startPageView('/b');

    expect(mocks.startSpan).toHaveBeenLastCalledWith(
      'page.view',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'page.path': '/b',
          'page.previous_path': '/a',
        }),
      }),
    );
  });

  it('ends the previous span before starting a new one', () => {
    startPageView('/a');
    expect(mocks.end).not.toHaveBeenCalled();

    startPageView('/b');
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });
});

describe('getCurrentPageView', () => {
  it('returns undefined when no span is active', () => {
    expect(getCurrentPageView()).toBeUndefined();
  });

  it('returns the active span after startPageView', () => {
    startPageView('/x');
    expect(getCurrentPageView()).toBeDefined();
  });

  it('returns undefined after endCurrentPageView', () => {
    startPageView('/x');
    endCurrentPageView();
    expect(getCurrentPageView()).toBeUndefined();
  });
});

describe('installRouteTracking', () => {
  it('starts a new page.view span when pushState changes pathname', () => {
    startPageView('/initial');
    installRouteTracking(() => {});
    mocks.startSpan.mockClear();

    window.history.pushState({}, '', '/next');

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'page.view',
      expect.objectContaining({
        attributes: expect.objectContaining({
          'page.path': '/next',
          'page.previous_path': '/initial',
        }),
      }),
    );
  });

  it('starts a new page.view span when replaceState changes pathname', () => {
    startPageView('/initial');
    installRouteTracking(() => {});
    mocks.startSpan.mockClear();

    window.history.replaceState({}, '', '/next');

    expect(mocks.startSpan).toHaveBeenCalledWith(
      'page.view',
      expect.objectContaining({
        attributes: expect.objectContaining({ 'page.path': '/next' }),
      }),
    );
  });

  it('does not start a new span when pushState keeps the same path', () => {
    startPageView('/same');
    installRouteTracking(() => {});
    mocks.startSpan.mockClear();

    window.history.pushState({}, '', '/same?with=query');

    expect(mocks.startSpan).not.toHaveBeenCalled();
  });

  it('does not double-install when called twice', () => {
    startPageView('/initial');
    installRouteTracking(() => {});
    installRouteTracking(() => {});
    mocks.startSpan.mockClear();

    window.history.pushState({}, '', '/next');

    expect(mocks.startSpan).toHaveBeenCalledTimes(1);
  });

  it('invokes the lifecycle callback on pagehide', () => {
    const onLifecycle = vi.fn();
    installRouteTracking(onLifecycle);

    window.dispatchEvent(new Event('pagehide'));

    expect(onLifecycle).toHaveBeenCalledTimes(1);
  });

  it('ends the current span on pagehide', () => {
    startPageView('/x');
    installRouteTracking(() => {});

    window.dispatchEvent(new Event('pagehide'));

    expect(getCurrentPageView()).toBeUndefined();
  });
});
