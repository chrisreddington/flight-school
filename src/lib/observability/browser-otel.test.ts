import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  WebTracerProvider: vi.fn(),
  register: vi.fn(),
  addSpanProcessor: vi.fn(),
  BatchSpanProcessor: vi.fn(),
  OTLPTraceExporter: vi.fn(),
  registerInstrumentations: vi.fn(),
  FetchInstrumentation: vi.fn(),
  DocumentLoadInstrumentation: vi.fn(),
  ZoneContextManager: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
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

  it('is idempotent across repeated calls', async () => {
    const { initBrowserOtel } = await loadModule();

    initBrowserOtel();
    initBrowserOtel();
    initBrowserOtel();

    expect(mocks.WebTracerProvider).toHaveBeenCalledTimes(1);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.registerInstrumentations).toHaveBeenCalledTimes(1);
  });
});
