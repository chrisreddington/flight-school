import { ROOT_CONTEXT, SpanKind, trace } from '@opentelemetry/api';
import { SamplingDecision } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';

import { createProxySampler, isProxyRouteSpan } from './proxy-sampler';

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

describe('createProxySampler', () => {
  const traceId = '00000000000000000000000000000001';

  it('drops the root SERVER span when http.target matches', () => {
    const sampler = createProxySampler();
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
    const sampler = createProxySampler();
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

  it('delegates unrelated root spans to the parent-based always-on sampler', () => {
    const sampler = createProxySampler();
    const result = sampler.shouldSample(
      ROOT_CONTEXT,
      traceId,
      'POST /api/profile',
      SpanKind.SERVER,
      { 'http.target': '/api/profile' },
      [],
    );
    // ParentBased + AlwaysOn root with no parent context yields
    // RECORD_AND_SAMPLED — i.e. unrelated routes continue to be traced.
    expect(result.decision).toBe(SamplingDecision.RECORD_AND_SAMPLED);
  });

  it('honours a non-recording parent for unrelated spans (parent-based delegate)', () => {
    const sampler = createProxySampler();
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
      { 'http.target': '/api/profile' },
      [],
    );
    // Non-sampled parent → ParentBasedSampler drops the child.
    expect(result.decision).toBe(SamplingDecision.NOT_RECORD);
  });

  it('reports a stable identifier via toString', () => {
    expect(createProxySampler().toString()).toBe('OtelProxyExcludingSampler');
  });
});
