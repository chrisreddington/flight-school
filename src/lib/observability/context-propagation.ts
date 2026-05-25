import { context, propagation, trace, type Context, type Link, type SpanContext, TraceFlags } from '@opentelemetry/api';

const PROPAGATION_HEADER_NAMES = ['traceparent', 'tracestate', 'baggage'] as const;

type PropagationHeaderName = (typeof PROPAGATION_HEADER_NAMES)[number];

export type TracePropagationHeaders = Partial<Record<PropagationHeaderName, string>>;

type HeaderCarrier = Headers | Record<string, string | undefined>;
const TRACEPARENT_RE = /^[\da-f]{2}-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})(?:-.*)?$/i;
const INVALID_TRACE_ID = '00000000000000000000000000000000';
const INVALID_SPAN_ID = '0000000000000000';

function normalizeHeaderRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};

  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) {
      out[key.toLowerCase()] = value;
    }
    return out;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    out[key.toLowerCase()] = value;
  }
  return out;
}

function toCarrier(headers: HeaderCarrier): Record<string, string> {
  if (headers instanceof Headers) {
    return normalizeHeaderRecord(headers);
  }

  const carrier: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') continue;
    carrier[key.toLowerCase()] = value;
  }
  return carrier;
}

function toTraceparent(spanContext: SpanContext): string | null {
  if (spanContext.traceId === INVALID_TRACE_ID || spanContext.spanId === INVALID_SPAN_ID) {
    return null;
  }

  const flags = (spanContext.traceFlags & TraceFlags.SAMPLED).toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

function parseTraceparent(traceparent: string): SpanContext | null {
  const trimmed = traceparent.trim();
  const match = TRACEPARENT_RE.exec(trimmed);
  if (!match) return null;

  const [, traceId, spanId, flagsHex] = match;
  if (traceId.toLowerCase() === INVALID_TRACE_ID || spanId.toLowerCase() === INVALID_SPAN_ID) {
    return null;
  }

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: (parseInt(flagsHex, 16) & 0xff) as TraceFlags,
    isRemote: true,
  };
}

export function buildSpanLinksFromTraceContext(traceContext: TracePropagationHeaders): Link[] {
  if (!traceContext.traceparent) {
    return [];
  }

  const spanContext = parseTraceparent(traceContext.traceparent);
  if (!spanContext) {
    return [];
  }

  return [{ context: spanContext }];
}

export function captureTracePropagationHeaders(sourceContext: Context = context.active()): TracePropagationHeaders {
  const carrier: Record<string, string> = {};
  propagation.inject(sourceContext, carrier);

  const out: TracePropagationHeaders = {};
  for (const name of PROPAGATION_HEADER_NAMES) {
    const value = carrier[name];
    if (typeof value === 'string' && value.length > 0) {
      out[name] = value;
    }
  }

  if (!out.traceparent) {
    const spanContext = trace.getSpan(sourceContext)?.spanContext();
    if (spanContext) {
      const fallbackTraceparent = toTraceparent(spanContext);
      if (fallbackTraceparent) {
        out.traceparent = fallbackTraceparent;
      }
    }
  }

  return out;
}

function extractTraceContextFromHeaders(headers: HeaderCarrier, baseContext: Context = context.active()): Context {
  const carrier = toCarrier(headers);
  const extractedContext = propagation.extract(baseContext, carrier);
  const extractedSpanContext = trace.getSpan(extractedContext)?.spanContext();
  if (extractedSpanContext && toTraceparent(extractedSpanContext)) {
    return extractedContext;
  }

  const spanContext = carrier.traceparent ? parseTraceparent(carrier.traceparent) : null;
  if (!spanContext) {
    return extractedContext;
  }

  return trace.setSpan(baseContext, trace.wrapSpanContext(spanContext));
}

export async function withExtractedTraceContext<T>(
  headers: HeaderCarrier,
  operation: (extractedContext: Context) => T | Promise<T>,
  baseContext: Context = context.active(),
): Promise<T> {
  const extractedContext = extractTraceContextFromHeaders(headers, baseContext);
  return await context.with(extractedContext, () => operation(extractedContext));
}

export function mergeTracePropagationHeaders(
  existingHeaders: HeadersInit | undefined,
  propagationHeaders: TracePropagationHeaders,
): Record<string, string> {
  const merged = normalizeHeaderRecord(existingHeaders);

  for (const name of PROPAGATION_HEADER_NAMES) {
    const value = propagationHeaders[name];
    if (!value) continue;
    if (merged[name] !== undefined) continue;
    merged[name] = value;
  }

  return merged;
}
