/**
 * Sampler that drops self-tracing spans for the browser→server OTel proxy
 * route (`/api/otel/v1/traces`).
 *
 * ## Why this exists
 *
 * The browser-side `BatchSpanProcessor` flushes pending spans on
 * `document.visibilitychange` — a legitimate behaviour that prevents data
 * loss when a tab is backgrounded. Each flush POSTs to the same-origin OTel
 * proxy at `/api/otel/v1/traces`. Next.js + `@vercel/otel` auto-instruments
 * incoming requests, so without intervention each export creates an HTTP
 * server span (plus framework children) which is itself exported on the next
 * BSP tick. The browser already excludes the proxy via
 * `FetchInstrumentation.ignoreUrls`, but the server side has no equivalent —
 * so every tab-switch produces a fresh proxy-trace that drowns out real app
 * telemetry on the dashboard.
 *
 * Dropping the root SERVER span here propagates `NOT_RECORD` to every child
 * span via the standard OTel parent-based sampling chain.
 */

import {
  AlwaysOnSampler,
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api';

/** Route prefix for the same-origin OTel trace proxy. */
const PROXY_PATH = '/api/otel/v1/traces';

const NOT_RECORD: SamplingResult = { decision: SamplingDecision.NOT_RECORD };

/**
 * Returns `true` if the given span name + attributes describe a request to
 * the internal OTel proxy route. Exposed for unit testing.
 *
 * The match deliberately checks multiple keys because Next.js / OTel HTTP
 * instrumentation populate different attributes at different stages of the
 * request lifecycle:
 *
 * - `http.target` and `url.path` are set by `@opentelemetry/instrumentation-http`
 *   at span creation (it has the request URL at that point).
 * - `http.route` is set later, once Next.js has matched the route.
 * - The Next.js framework span is named `"<METHOD> /api/otel/v1/traces"`.
 *
 * Matching on any of these keys means the sampler catches both the root
 * SERVER span and any descendant span that may be created from a context
 * where the parent's sampling decision was lost (defensive — should be
 * unreachable in practice).
 */
export function isProxyRouteSpan(
  spanName: string,
  attrs: Attributes | undefined,
): boolean {
  if (spanName.endsWith(PROXY_PATH)) {
    return true;
  }

  if (!attrs) {
    return false;
  }

  const target = attrs['http.target'];
  if (typeof target === 'string' && target.startsWith(PROXY_PATH)) {
    return true;
  }

  const urlPath = attrs['url.path'];
  if (typeof urlPath === 'string' && urlPath.startsWith(PROXY_PATH)) {
    return true;
  }

  const route = attrs['http.route'];
  if (typeof route === 'string' && route.startsWith(PROXY_PATH)) {
    return true;
  }

  return false;
}

/**
 * Builds a {@link Sampler} that drops spans for the OTel proxy route and
 * delegates all other decisions to a parent-based always-on sampler.
 *
 * Exposed as a factory (rather than a singleton) so unit tests can construct
 * fresh instances without shared state.
 */
export function createProxySampler(): Sampler {
  const delegate = new ParentBasedSampler({ root: new AlwaysOnSampler() });

  return {
    shouldSample(
      context: Context,
      traceId: string,
      spanName: string,
      spanKind: SpanKind,
      attributes: Attributes,
      links: Link[],
    ): SamplingResult {
      if (isProxyRouteSpan(spanName, attributes)) {
        return NOT_RECORD;
      }
      return delegate.shouldSample(
        context,
        traceId,
        spanName,
        spanKind,
        attributes,
        links,
      );
    },
    toString(): string {
      return 'OtelProxyExcludingSampler';
    },
  };
}
