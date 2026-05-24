import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  WebTracerProvider: vi.fn(),
  register: vi.fn(),
  addSpanProcessor: vi.fn(),
  BatchSpanProcessor: vi.fn(),
  forceFlush: vi.fn().mockResolvedValue(undefined),
  OTLPTraceExporter: vi.fn(),
  registerInstrumentations: vi.fn(),
  FetchInstrumentation: vi.fn(),
  DocumentLoadInstrumentation: vi.fn(),
  ZoneContextManager: vi.fn(),
  installRouteTracking: vi.fn(),
  startPageView: vi.fn(),
  getCurrentPageView: vi.fn(),
  contextWith: vi.fn((_ctx, fn) => fn()),
  setSpan: vi.fn((ctx) => ctx),
}));

vi.mock('@opentelemetry/sdk-trace-web', () => {
  class WebTracerProvider {
    constructor(args: unknown) {
      mocks.WebTracerProvider(args);
    }
    register(opts: unknown) {
      mocks.register(opts);
    }
    addSpanProcessor(p: unknown) {
      mocks.addSpanProcessor(p);
    }
  }
  class BatchSpanProcessor {
    constructor(exporter: unknown) {
      mocks.BatchSpanProcessor(exporter);
    }
    forceFlush() {
      return mocks.forceFlush();
    }
  }
  return { WebTracerProvider, BatchSpanProcessor };
});

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class {
    constructor(opts: unknown) {
      mocks.OTLPTraceExporter(opts);
    }
  },
}));

vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: (opts: unknown) => mocks.registerInstrumentations(opts),
}));

vi.mock('@opentelemetry/instrumentation-fetch', () => ({
  FetchInstrumentation: class {
    constructor(opts: unknown) {
      mocks.FetchInstrumentation(opts);
    }
  },
}));

vi.mock('@opentelemetry/instrumentation-document-load', () => ({
  DocumentLoadInstrumentation: class {
    constructor(opts: unknown) {
      mocks.DocumentLoadInstrumentation(opts);
    }
  },
}));

vi.mock('@opentelemetry/context-zone', () => ({
  ZoneContextManager: class {
    constructor() {
      mocks.ZoneContextManager();
    }
  },
}));

vi.mock('@opentelemetry/resources', () => ({
  defaultResource: () => ({ merge: (other: unknown) => other }),
  resourceFromAttributes: (attrs: unknown) => attrs,
}));

vi.mock('@opentelemetry/api', () => ({
  context: {
    active: () => ({}),
    with: (ctx: unknown, fn: () => unknown) => mocks.contextWith(ctx, fn),
  },
  trace: {
    setSpan: (ctx: unknown, span: unknown) => mocks.setSpan(ctx, span),
  },
}));

vi.mock('./route-tracking', () => ({
  installRouteTracking: (cb: () => void) => mocks.installRouteTracking(cb),
  startPageView: (path: string) => mocks.startPageView(path),
  getCurrentPageView: () => mocks.getCurrentPageView(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Restore native fetch between tests so the wrap idempotency check works
  // against a known baseline.
  (window as unknown as { fetch: typeof fetch }).fetch = (() => Promise.resolve(new Response())) as typeof fetch;
});

async function loadModule() {
  vi.resetModules();
  return import('./browser-otel');
}

describe('initBrowserOtel', () => {
  it('configures an OTLP exporter pointing at the proxy route', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    expect(mocks.OTLPTraceExporter).toHaveBeenCalledTimes(1);
    const exporterOpts = mocks.OTLPTraceExporter.mock.calls[0][0];
    expect(exporterOpts.url).toBe('/api/otel/v1/traces');
  });

  it('configures the exporter with keepalive: true for unload delivery', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    const exporterOpts = mocks.OTLPTraceExporter.mock.calls[0][0];
    expect(exporterOpts.fetchOptions).toEqual({ keepalive: true });
  });

  it('registers fetch and document-load instrumentations', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    expect(mocks.FetchInstrumentation).toHaveBeenCalledTimes(1);
    expect(mocks.DocumentLoadInstrumentation).toHaveBeenCalledTimes(1);
    expect(mocks.registerInstrumentations).toHaveBeenCalledTimes(1);
  });

  it('excludes the proxy route from fetch instrumentation to avoid recursion', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    const fetchOpts = mocks.FetchInstrumentation.mock.calls[0][0] as {
      ignoreUrls: Array<RegExp | string>;
    };
    expect(fetchOpts.ignoreUrls).toBeDefined();
    const matchesProxy = fetchOpts.ignoreUrls.some((p) =>
      p instanceof RegExp ? p.test('/api/otel/v1/traces') : p === '/api/otel/v1/traces',
    );
    expect(matchesProxy).toBe(true);
  });

  it('renames the fetch span to include method and pathname', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    const fetchOpts = mocks.FetchInstrumentation.mock.calls[0][0] as {
      applyCustomAttributesOnSpan: (
        span: { setAttribute: ReturnType<typeof vi.fn>; updateName: ReturnType<typeof vi.fn> },
        request: { url: string; method: string },
      ) => void;
    };
    const span = { setAttribute: vi.fn(), updateName: vi.fn() };
    fetchOpts.applyCustomAttributesOnSpan(span, {
      url: 'https://example.com/api/profile?token=secret',
      method: 'post',
    });

    expect(span.updateName).toHaveBeenCalledWith('POST /api/profile');
    expect(span.setAttribute).toHaveBeenCalledWith(
      'http.url',
      'https://example.com/api/profile',
    );
  });

  it('starts the initial page.view span synchronously', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    expect(mocks.startPageView).toHaveBeenCalledTimes(1);
    expect(mocks.startPageView).toHaveBeenCalledWith(window.location.pathname);
  });

  it('installs route tracking with a lifecycle callback that forceFlushes', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();

    expect(mocks.installRouteTracking).toHaveBeenCalledTimes(1);
    const callback = mocks.installRouteTracking.mock.calls[0][0] as () => void;
    callback();
    expect(mocks.forceFlush).toHaveBeenCalledTimes(1);
  });

  it('wraps window.fetch and routes calls through the page.view context', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response());
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch as unknown as typeof fetch;
    const pageSpan = { id: 'page-span' };
    mocks.getCurrentPageView.mockReturnValue(pageSpan);

    const { initBrowserOtel } = await loadModule();
    initBrowserOtel();

    await window.fetch('/api/foo');

    expect(mocks.setSpan).toHaveBeenCalledWith(expect.anything(), pageSpan);
    expect(mocks.contextWith).toHaveBeenCalledTimes(1);
    expect(originalFetch).toHaveBeenCalledWith('/api/foo');
  });

  it('falls through to the original fetch when no page.view span is active', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response());
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch as unknown as typeof fetch;
    mocks.getCurrentPageView.mockReturnValue(undefined);

    const { initBrowserOtel } = await loadModule();
    initBrowserOtel();

    await window.fetch('/api/foo');

    expect(mocks.contextWith).not.toHaveBeenCalled();
    expect(originalFetch).toHaveBeenCalledWith('/api/foo');
  });

  it('does not double-wrap window.fetch across repeated initialisations', async () => {
    const { initBrowserOtel } = await loadModule();
    initBrowserOtel();
    const wrappedOnce = window.fetch;

    initBrowserOtel();
    expect(window.fetch).toBe(wrappedOnce);
  });

  it('is idempotent across repeated calls', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();
    initBrowserOtel();
    initBrowserOtel();

    expect(mocks.WebTracerProvider).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registerInstrumentations).toHaveBeenCalledTimes(1);
    expect(mocks.startPageView).toHaveBeenCalledTimes(1);
  });
});
