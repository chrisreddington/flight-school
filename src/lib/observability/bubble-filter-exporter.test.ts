import { SpanKind } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it, vi } from 'vitest';

import {
  BubbleFilteringSpanExporter,
  isFrameworkUpdateCheckSpan,
  isNextjsBubbleReadableSpan,
} from './bubble-filter-exporter';

function makeSpan(overrides: {
  kind?: SpanKind;
  attributes?: Record<string, unknown>;
}): ReadableSpan {
  // ReadableSpan has many fields; for filter logic we only need
  // `kind` and `attributes`. Cast to satisfy the interface.
  return {
    kind: overrides.kind ?? SpanKind.SERVER,
    attributes: overrides.attributes ?? {},
  } as unknown as ReadableSpan;
}

class StubExporter implements SpanExporter {
  public exported: ReadableSpan[][] = [];
  public shutdownCalls = 0;
  public flushCalls = 0;

  export(spans: ReadableSpan[], cb: (result: ExportResult) => void): void {
    this.exported.push(spans);
    cb({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    this.flushCalls += 1;
    return Promise.resolve();
  }
}

describe('isNextjsBubbleReadableSpan', () => {
  it('matches a SERVER span with next.bubble === true (boolean)', () => {
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({ kind: SpanKind.SERVER, attributes: { 'next.bubble': true } }),
      ),
    ).toBe(true);
  });

  it('matches a SERVER span with next.bubble === "true" (string)', () => {
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({ kind: SpanKind.SERVER, attributes: { 'next.bubble': 'true' } }),
      ),
    ).toBe(true);
  });

  it('does NOT match a SERVER span with operation.name = "next_js.BaseServer.handleRequest" alone', () => {
    // FALSE-POSITIVE GUARD: a keeper that errors BEFORE the route is
    // resolved (e.g. middleware rejection) lacks `http.route`, so
    // @vercel/otel's CompositeSpanProcessor.onEnd assigns it
    // operation.name="next_js.BaseServer.handleRequest". Such a failed
    // keeper does NOT have next.bubble (per Next.js source,
    // `closeSpanWithError` only sets next.bubble on the bubble wrapper),
    // so it must NOT be dropped. The discriminator is next.bubble alone.
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({
          kind: SpanKind.SERVER,
          attributes: { 'operation.name': 'next_js.BaseServer.handleRequest' },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match the keeper (operation.name = "web.request" + http.route set)', () => {
    // REGRESSION GUARD: this is the templated route keeper at export time.
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({
          kind: SpanKind.SERVER,
          attributes: {
            'operation.name': 'web.request',
            'http.route': '/api/profile',
            'next.route': '/api/profile',
            'resource.name': 'GET /api/profile',
          },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match CLIENT spans even if next.bubble is somehow set', () => {
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({ kind: SpanKind.CLIENT, attributes: { 'next.bubble': true } }),
      ),
    ).toBe(false);
  });

  it('does NOT match INTERNAL spans', () => {
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({
          kind: SpanKind.INTERNAL,
          attributes: { 'next.bubble': true },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match spans without any discriminator', () => {
    expect(
      isNextjsBubbleReadableSpan(
        makeSpan({
          kind: SpanKind.SERVER,
          attributes: { 'http.method': 'GET', 'http.target': '/api/x' },
        }),
      ),
    ).toBe(false);
  });
});

describe('isFrameworkUpdateCheckSpan', () => {
  it('matches the Next.js dev-only npm registry dist-tags fetch', () => {
    expect(
      isFrameworkUpdateCheckSpan(
        makeSpan({
          kind: SpanKind.CLIENT,
          attributes: {
            'http.method': 'GET',
            'http.url': 'https://registry.npmjs.org/-/package/next/dist-tags',
          },
        }),
      ),
    ).toBe(true);
  });

  it('does NOT match SERVER spans', () => {
    expect(
      isFrameworkUpdateCheckSpan(
        makeSpan({
          kind: SpanKind.SERVER,
          attributes: {
            'http.url': 'https://registry.npmjs.org/-/package/next/dist-tags',
          },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match unrelated registry.npmjs.org URLs', () => {
    expect(
      isFrameworkUpdateCheckSpan(
        makeSpan({
          kind: SpanKind.CLIENT,
          attributes: {
            'http.url': 'https://registry.npmjs.org/-/package/react/dist-tags',
          },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT match CLIENT spans with no http.url', () => {
    expect(
      isFrameworkUpdateCheckSpan(
        makeSpan({ kind: SpanKind.CLIENT, attributes: {} }),
      ),
    ).toBe(false);
  });
});

describe('BubbleFilteringSpanExporter', () => {
  it('forwards only non-bubble spans to the delegate', () => {
    const delegate = new StubExporter();
    const exporter = new BubbleFilteringSpanExporter(delegate);

    const bubble = makeSpan({
      kind: SpanKind.SERVER,
      attributes: { 'next.bubble': true, 'http.method': 'GET' },
    });
    const keeper = makeSpan({
      kind: SpanKind.SERVER,
      attributes: {
        'operation.name': 'web.request',
        'http.route': '/api/profile',
      },
    });
    const handler = makeSpan({
      kind: SpanKind.INTERNAL,
      attributes: { 'next.span_type': 'AppRouteRouteHandlers.runHandler' },
    });

    const cb = vi.fn();
    exporter.export([bubble, keeper, handler], cb);

    expect(delegate.exported).toHaveLength(1);
    expect(delegate.exported[0]).toEqual([keeper, handler]);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('short-circuits with SUCCESS when every span is filtered out', () => {
    const delegate = new StubExporter();
    const exporter = new BubbleFilteringSpanExporter(delegate);

    const bubble1 = makeSpan({
      kind: SpanKind.SERVER,
      attributes: { 'next.bubble': true },
    });
    const bubble2 = makeSpan({
      kind: SpanKind.SERVER,
      attributes: { 'next.bubble': 'true' },
    });

    const cb = vi.fn();
    exporter.export([bubble1, bubble2], cb);

    expect(delegate.exported).toHaveLength(0);
    expect(cb).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('passes everything through when no bubbles are present', () => {
    const delegate = new StubExporter();
    const exporter = new BubbleFilteringSpanExporter(delegate);

    const keeper = makeSpan({
      kind: SpanKind.SERVER,
      attributes: { 'http.route': '/api/profile' },
    });
    const fetch = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: { 'http.method': 'GET' },
    });

    const cb = vi.fn();
    exporter.export([keeper, fetch], cb);

    expect(delegate.exported).toHaveLength(1);
    expect(delegate.exported[0]).toEqual([keeper, fetch]);
  });

  it('drops Next.js dev-only npm registry update-check spans', () => {
    const delegate = new StubExporter();
    const exporter = new BubbleFilteringSpanExporter(delegate);

    const updateCheck = makeSpan({
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': 'GET',
        'http.url': 'https://registry.npmjs.org/-/package/next/dist-tags',
      },
    });
    const keeper = makeSpan({
      kind: SpanKind.SERVER,
      attributes: { 'http.route': '/api/profile' },
    });

    const cb = vi.fn();
    exporter.export([updateCheck, keeper], cb);

    expect(delegate.exported).toHaveLength(1);
    expect(delegate.exported[0]).toEqual([keeper]);
  });

  it('delegates shutdown and forceFlush', async () => {
    const delegate = new StubExporter();
    const exporter = new BubbleFilteringSpanExporter(delegate);

    await exporter.shutdown();
    await exporter.forceFlush();

    expect(delegate.shutdownCalls).toBe(1);
    expect(delegate.flushCalls).toBe(1);
  });

  it('handles delegates that do not implement forceFlush', async () => {
    const delegate: SpanExporter = {
      export: () => {},
      shutdown: () => Promise.resolve(),
    };
    const exporter = new BubbleFilteringSpanExporter(delegate);

    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });
});
