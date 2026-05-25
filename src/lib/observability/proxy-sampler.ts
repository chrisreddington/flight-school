/**
 * Telemetry-hygiene sampler. Drops two classes of noisy spans at
 * `shouldSample()` (head-sampling) time:
 *
 * 1. **OTel-proxy self-trace** — server-side spans for the browser→server
 *    OTel proxy route (`/api/otel/v1/traces`). Discriminated by span name
 *    and/or `http.target` / `url.path` — all available at `startSpan()` time.
 * 2. **Next.js framework stub INTERNAL spans** — sub-millisecond spans
 *    Next.js emits for internal hooks (`resolve page components`,
 *    `start response`, …). They add visual noise to the trace tree and
 *    carry no actionable signal. Discriminated by an allowlist of
 *    `next.span_type` values — set by Next.js's `NextTracerImpl.trace()`
 *    on the initial `startSpan()` attributes, so visible to the sampler.
 *
 * Dropping at the sampler stage propagates `NOT_RECORD` to every child
 * span via the standard OTel parent-based sampling chain — which means
 * **only attributes that exist at `startSpan()` time are safe
 * discriminators here.** Any attribute set later via `span.setAttribute()`
 * or by a downstream `SpanProcessor.onEnd` hook is invisible to this
 * sampler.
 *
 * ## What is NOT dropped here: Next.js "bubble" wrapper SERVER spans
 *
 * For every API request Next.js emits **two SERVER spans as siblings**
 * under the browser fetch: a "bubble" wrapper (bare-method name, no route,
 * tagged with `next.bubble = true` and `operation.name =
 * "next_js.BaseServer.handleRequest"`) and the real route keeper
 * (`"METHOD /api/route"`, has `http.route`, has `operation.name =
 * "web.request"`). The bubble is duplicate noise on dashboards.
 *
 * **The bubble cannot be dropped at this sampler.** Both spans are
 * structurally identical at `startSpan()` time — they share the same
 * bare-method name (`"GET"`, `"POST"`, …), the same `next.span_type =
 * "BaseServer.handleRequest"`, and the same start attributes
 * (`http.method`, `http.target`). The discriminating attributes are all
 * set later: `next.bubble` via `span.setAttribute()` in Next.js's
 * `closeSpanWithError`; `http.route`, `next.route`, and the renamed span
 * name via `span.updateName()` in the route-match hook; `operation.name`
 * by `@vercel/otel`'s `CompositeSpanProcessor.onEnd`.
 *
 * Any sampler-level discriminator either no-ops (the discriminating
 * attribute is not yet set) or drops the real route span too — which
 * cascades through `ParentBasedSampler` and kills every child span in
 * the trace (route handler, GitHub calls, worker side). Bubble
 * filtering therefore lives at the export boundary instead.
 *
 * **Bubble filtering now lives at the export boundary.** See
 * `src/lib/observability/bubble-filter-exporter.ts` (`BubbleFilteringSpanExporter`),
 * which discriminates on the fully-materialised attributes
 * (`next.bubble === true`, `operation.name === "next_js.BaseServer.handleRequest"`)
 * and is wired via `registerOTel({ traceExporter: ... })` in
 * `src/instrumentation.ts`. A mistake there would drop only the
 * misidentified span — never its children — so the tree-kill failure
 * mode is structurally impossible.
 *
 * ## Why the OTel-proxy self-trace exists
 *
 * The browser-side `BatchSpanProcessor` flushes pending spans on
 * `document.visibilitychange` — a legitimate behaviour that prevents data
 * loss when a tab is backgrounded. Each flush POSTs to the same-origin OTel
 * proxy at `/api/otel/v1/traces`. Next.js auto-instruments incoming
 * requests, so without intervention each export creates an HTTP server span
 * (plus framework children) which is itself exported on the next BSP tick.
 * The browser already excludes the proxy via
 * `FetchInstrumentation.ignoreUrls`, but the server side has no equivalent —
 * so every tab-switch would produce a fresh proxy-trace that drowns out
 * real app telemetry on the dashboard.
 */

import {
  AlwaysOnSampler,
  ParentBasedSampler,
  SamplingDecision,
  type Sampler,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import type { Attributes, Context, Link } from '@opentelemetry/api';
import { SpanKind } from '@opentelemetry/api';

/** Route prefix for the same-origin OTel trace proxy. */
const PROXY_PATH = '/api/otel/v1/traces';

const NOT_RECORD: SamplingResult = { decision: SamplingDecision.NOT_RECORD };

/**
 * Allowlist of `next.span_type` values to drop. These correspond to
 * sub-millisecond INTERNAL spans Next.js emits for its own framework hooks
 * — useful when debugging Next.js itself, but pure noise in an application
 * trace tree.
 *
 * Confirmed via diagnostic against the running Aspire dashboard:
 *
 * | `next.span_type`                         | Span name                  |
 * | ---------------------------------------- | -------------------------- |
 * | `NextNodeServer.findPageComponents`      | `resolve page components`  |
 * | `NextNodeServer.startResponse`           | `start response`           |
 *
 * Spans we deliberately **keep** include
 * `AppRouteRouteHandlers.runHandler` (the actual route handler body) and
 * `BaseServer.handleRequest` (the templated SERVER span — see bubble-span
 * docs above).
 */
const NEXTJS_FRAMEWORK_STUB_SPAN_TYPES = new Set<string>([
  'NextNodeServer.findPageComponents',
  'NextNodeServer.startResponse',
]);

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
export function isProxyRouteSpan(spanName: string, attrs: Attributes | undefined): boolean {
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
 * Returns `true` if the given span is a Next.js framework stub INTERNAL
 * span on the allowlist. Exposed for unit testing.
 */
function isNextjsFrameworkStubSpan(spanKind: SpanKind | undefined, attrs: Attributes | undefined): boolean {
  if (spanKind !== undefined && spanKind !== SpanKind.INTERNAL) {
    return false;
  }
  const spanType = attrs?.['next.span_type'];
  return typeof spanType === 'string' && NEXTJS_FRAMEWORK_STUB_SPAN_TYPES.has(spanType);
}

/**
 * Builds a {@link Sampler} that drops two classes of noisy spans at
 * head-sampling time (OTel proxy self-trace, Next.js framework stub
 * INTERNAL spans) and delegates all other decisions to a parent-based
 * always-on sampler.
 *
 * Bubble-span filtering is intentionally NOT done here — see the file
 * header for the rationale and `bubble-filter-exporter.ts` for the
 * export-time implementation.
 *
 * Exposed as a factory (rather than a singleton) so unit tests can construct
 * fresh instances without shared state.
 */
export function createTelemetryHygieneSampler(): Sampler {
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
      if (isNextjsFrameworkStubSpan(spanKind, attributes)) {
        return NOT_RECORD;
      }
      return delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links);
    },
    toString(): string {
      return 'TelemetryHygieneSampler';
    },
  };
}
