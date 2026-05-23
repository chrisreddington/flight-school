import { context, trace, TraceFlags } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import {
  buildSpanLinksFromTraceContext,
  captureTracePropagationHeaders,
  mergeTracePropagationHeaders,
  withExtractedTraceContext,
} from './context-propagation';

describe('context-propagation', () => {
  it('captures W3C trace headers from an explicit context', () => {
    const spanContext = {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    } as const;
    const explicitContext = trace.setSpan(
      context.active(),
      trace.wrapSpanContext(spanContext),
    );

    const headers = captureTracePropagationHeaders(explicitContext);

    expect(headers.traceparent).toBe('00-11111111111111111111111111111111-2222222222222222-01');
  });

  it('preserves caller-supplied traceparent when merging headers', () => {
    const merged = mergeTracePropagationHeaders(
      { authorization: 'Bearer secret', traceparent: '00-existing-existing-existing-01' },
      {
        traceparent: '00-new-new-new-01',
        tracestate: 'vendor=value',
      },
    );

    expect(merged.authorization).toBe('Bearer secret');
    expect(merged.traceparent).toBe('00-existing-existing-existing-01');
    expect(merged.tracestate).toBe('vendor=value');
  });

  it('round-trips propagated headers through extracted context', async () => {
    const traceparent = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01';

    const reboundHeaders = await withExtractedTraceContext(
      { traceparent },
      async (extractedContext) => captureTracePropagationHeaders(extractedContext),
    );

    expect(reboundHeaders.traceparent).toBe(traceparent);
  });

  it('builds a span link from valid trace context', () => {
    const links = buildSpanLinksFromTraceContext({
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    });

    expect(links).toHaveLength(1);
    expect(links[0].context.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(links[0].context.spanId).toBe('bbbbbbbbbbbbbbbb');
  });
});
