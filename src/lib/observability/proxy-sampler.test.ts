import { ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import {
  createTelemetryHygieneSampler,
  isProxyRouteSpan,
} from './proxy-sampler';

describe('isProxyRouteSpan', () => {
  it('matches when spanName ends with the proxy path', () => {
    expect(isProxyRouteSpan('POST /api/otel/v1/traces', undefined)).toBe(true);
    expect(isProxyRouteSpan('GET /api/otel/v1/traces', undefined)).toBe(true);
  });

  it('matches when http.target starts with the proxy path', () => {
    expect(
      isProxyRouteSpan('POST', { 'http.target': '/api/otel/v1/traces' }),
    ).toBe(true);
  });

  it('matches when url.path starts with the proxy path', () => {
    expect(
      isProxyRouteSpan('POST', { 'url.path': '/api/otel/v1/traces' }),
    ).toBe(true);
  });

  it('matches when http.route starts with the proxy path', () => {
    expect(
      isProxyRouteSpan('next.route', { 'http.route': '/api/otel/v1/traces' }),
    ).toBe(true);
  });

  it('does not match unrelated spans', () => {
    expect(isProxyRouteSpan('GET /api/profile', undefined)).toBe(false);
    expect(
      isProxyRouteSpan('POST', { 'http.target': '/api/learning-chat/stream' }),
    ).toBe(false);
    expect(
      isProxyRouteSpan('resolve page components', {
        'next.span.type': 'AppRender.getBodyResult',
      }),
    ).toBe(false);
  });

  it('does not match when only a substring (not prefix) of the path appears', () => {
    expect(
      isProxyRouteSpan('POST', { 'http.target': '/other/api/otel/v1/traces' }),
    ).toBe(false);
  });
});

describe('createTelemetryHygieneSampler', () => {
  const traceId = '00000000000000000000000000000001';

  it('drops the root SERVER span when http.target matches', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'POST',
      SpanKind.SERVER,
      { 'http.target': '/api/otel/v1/traces' },
      [],
    );
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('drops the framework route span by name alone', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'POST /api/otel/v1/traces',
      SpanKind.SERVER,
      {},
      [],
    );
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('does NOT drop bare-method SERVER spans at sample time (bubble + keeper both pass through)', () => {
    // CRITICAL ARCHITECTURAL INVARIANT. At shouldSample()/startSpan() time,
    // the Next.js bubble and the route keeper are STRUCTURALLY IDENTICAL:
    // both have a bare-method name ("GET", "POST"), both have
    // next.span_type="BaseServer.handleRequest", neither has next.bubble,
    // http.route, next.route, or operation.name (all set later).
    //
    // Therefore the sampler MUST pass both through. Bubble filtering is
    // done at export time by BubbleFilteringSpanExporter, where every
    // discriminating attribute is fully materialised. Filtering here would
    // either:
    //   - silently no-op (using attributes that aren't yet set), or
    //   - drop the keeper too, killing the entire downstream tree via
    //     ParentBasedSampler propagation (PR1 regression).
    //
    // Even when next.bubble is somehow present at sample time (e.g. set
    // by a future Next.js version on the initial startSpan attributes),
    // the sampler still passes — bubble filtering is the exporter's job.
    const sampler = createTelemetryHygieneSampler();
    const startTimeShapes: Array<{ label: string; attrs: Record<string, unknown> }> = [
      {
        label: 'keeper-at-start (no discriminating attrs)',
        attrs: {
          'next.span_type': 'BaseServer.handleRequest',
          'http.target': '/api/profile',
        },
      },
      {
        label: 'bubble-at-start (Next.js sets next.bubble later, but defend anyway)',
        attrs: {
          'next.span_type': 'BaseServer.handleRequest',
          'next.bubble': 'true',
          'http.target': '/api/profile',
        },
      },
    ];
    for (const name of ['GET', 'POST', 'HTTP GET', 'PUT', 'DELETE']) {
      for (const shape of startTimeShapes) {
        const result = sampler.shouldSample(
          ROOT_CONTEXT,
          traceId,
          name,
          SpanKind.SERVER,
          shape.attrs,
          [],
        );
        expect(result.decision, `name=${name} ${shape.label}`).toBe(
          SamplingDecision.RECORD_AND_SAMPLED,
        );
      }
    }
  });

  it('keeps the templated SERVER span (the keeper sibling)', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'GET /api/profile',
      SpanKind.SERVER,
      {
        'next.span_type': 'BaseServer.handleRequest',
        'next.route': '/api/profile',
        'http.route': '/api/profile',
      },
      [],
    );
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('does not drop CLIENT-kind spans named GET (outbound fetches)', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'GET',
      SpanKind.CLIENT,
      {},
      [],
    );
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('delegates unrelated root spans to the parent-based always-on sampler', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'POST /api/profile',
      SpanKind.SERVER,
      { 'http.target': '/api/profile', 'http.route': '/api/profile' },
      [],
    );
    // ParentBased + AlwaysOn root with no parent context yields
    // RECORD_AND_SAMPLED — i.e. unrelated routes continue to be traced.
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('honours a non-recording parent for unrelated spans (parent-based delegate)', () => {
    const sampler = createTelemetryHygieneSampler();
    const parentSpanContext = {
      traceId,
      spanId: '0000000000000002',
      traceFlags: 0,
      isRemote: false,
    };
    const ctxWithParent = trace.setSpanContext(ROOT_CONTEXT, parentSpanContext);
    const result = sampler.shouldSample(
      ctxWithParent,
      traceId,
      'POST /api/profile',
      SpanKind.SERVER,
      { 'http.target': '/api/profile', 'http.route': '/api/profile' },
      [],
    );
    // Non-sampled parent → ParentBasedSampler drops the child.
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('drops Next.js framework stub INTERNAL spans by next.span_type', () => {
    const sampler = createTelemetryHygieneSampler();
    for (const spanType of [
      'NextNodeServer.findPageComponents',
      'NextNodeServer.startResponse',
    ]) {
      const result = sampler.shouldSample(
        ROOT_CONTEXT,
        traceId,
        'resolve page components',
        SpanKind.INTERNAL,
        { 'next.span_type': spanType },
        [],
      );
      expect(result.decision, `span_type=${spanType}`).toBe(
        SamplingDecision.NOT_RECORD,
      );
    }
  });

  it('keeps the route-handler INTERNAL span (AppRouteRouteHandlers.runHandler)', () => {
    const sampler = createTelemetryHygieneSampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'executing api route (app) /api/profile',
      SpanKind.INTERNAL,
      { 'next.span_type': 'AppRouteRouteHandlers.runHandler' },
      [],
    );
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('reports a stable identifier via toString', () => {
    expect(createTelemetryHygieneSampler().toString()).toBe(
      'TelemetryHygieneSampler',
    );
  });
});


