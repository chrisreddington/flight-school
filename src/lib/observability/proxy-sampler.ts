/**
 * Telemetry-hygiene sampler. Drops three classes of noisy spans before they
 * reach the exporter:
 *
 * 1. **OTel-proxy self-trace** — server-side spans for the browser→server
 *    OTel proxy route (`/api/otel/v1/traces`).
 * 2. **Next.js "bubble" wrapper SERVER span** — the bare-method `"GET"` /
 *    `"POST"` etc. SERVER span emitted by `BaseServer.handleRequest` with
 *    `next.bubble: "true"` and no `http.route`. Next.js emits two SERVER
 *    spans per request: this wrapper (which loses the route template) plus
 *    the templated `"GET /api/route"` span. We keep the templated one
 *    because it owns `http.route`, App Router lifecycle attributes, and
 *    matches what dashboards aggregate on.
 * 3. **Next.js framework stub INTERNAL spans** — sub-millisecond spans
 *    Next.js emits for internal hooks (`resolve page components`,
 *    `start response`, …). They add visual noise to the trace tree and
 *    carry no actionable signal. Drop based on an allowlist of
 *    `next.span_type` values.
 *
 * Dropping at the sampler stage propagates `NOT_RECORD` to every child
 * span via the standard OTel parent-based sampling chain.
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
 *
 * ## Why the Next.js bubble span is dropped
 *
 * Diagnosis (PR1 of the telemetry-hygiene cleanup): for every API request
 * Next.js emits **two SERVER spans as siblings** under the browser fetch:
 *
 * ```
 * [Client]  HTTP GET                          src=flight-school-browser
 * ├─ [Server] GET                             src=flight-school   5ms
 * │  attrs: next.span_type=BaseServer.handleRequest, next.bubble="true",
 * │         next.rsc="false", http.target=/api/route   (no http.route)
 * └─ [Server] GET /api/route                  src=flight-school   20ms
 *    attrs: next.span_type=BaseServer.handleRequest, http.route=/api/route,
 *           next.route=/api/route, operation.name=web.request
 *    └─ executing api route (app) /api/route
 *    └─ resolve page components / start response   (stubs — see PR2)
 * ```
 *
 * Both are emitted by Next.js's own internal tracer (not
 * `@opentelemetry/instrumentation-http`; `@vercel/otel` v2 default is
 * `["fetch"]` only). The bubble span lacks the route template, so anything
 * aggregating by `http.route` mis-bins it as a bare `"GET"`. Dropping it
 * leaves the templated sibling intact, which is what we actually want.
 *
 * The unique discriminator is `next.bubble === "true"` (a Next.js-internal
 * flag set at span creation, present on the bubble and absent on the
 * keeper). See {@link isNextjsBubbleSpan} for why a name-based backup
 * was previously tried and removed.
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
 * Returns `true` if the given SERVER span is the Next.js "bubble" wrapper
 * span — the bare-method sibling that loses the route template. Exposed
 * for unit testing.
 *
 * Discriminator: `next.bubble === "true"` (a Next.js-internal flag set at
 * span creation, only on the bubble span — never on the keeper).
 *
 * **Why no name-based backup.** A previous version of this function
 * included a defensive backup that dropped any bare-method SERVER span
 * (`"GET"`, `"POST"`, …) without `http.route`. That backup was buggy:
 * `shouldSample()` runs at `startSpan()` time, before Next.js renames the
 * keeper span from `"POST"` → `"POST /api/route"` and before
 * `http.route` is populated. At that moment the keeper sibling looked
 * identical to the bubble (bare method, no `http.route`) and the backup
 * dropped it too. Because the dropped keeper became the parent of every
 * route-handler, GitHub-request, and worker-side span, the entire
 * downstream trace tree vanished via `ParentBasedSampler` propagation.
 *
 * The primary `next.bubble` flag is unambiguous and is set at span
 * creation, so it is reliable on its own. If a future Next.js version
 * stops emitting `next.bubble`, the bubble span will resurface in
 * dashboards — accept that trade-off rather than risk silent data loss.
 */
export function isNextjsBubbleSpan(
  spanKind: SpanKind | undefined,
  attrs: Attributes | undefined,
): boolean {
  if (spanKind !== undefined && spanKind !== SpanKind.SERVER) {
    return false;
  }

  const bubble = attrs?.['next.bubble'];
  return bubble === 'true' || bubble === true;
}

/**
 * Returns `true` if the given span is a Next.js framework stub INTERNAL
 * span on the allowlist. Exposed for unit testing.
 */
export function isNextjsFrameworkStubSpan(
  spanKind: SpanKind | undefined,
  attrs: Attributes | undefined,
): boolean {
  if (spanKind !== undefined && spanKind !== SpanKind.INTERNAL) {
    return false;
  }
  const spanType = attrs?.['next.span_type'];
  return (
    typeof spanType === 'string' && NEXTJS_FRAMEWORK_STUB_SPAN_TYPES.has(spanType)
  );
}

/**
 * Builds a {@link Sampler} that drops three classes of noisy spans (OTel
 * proxy self-trace, Next.js bubble wrapper SERVER span, Next.js framework
 * stub INTERNAL spans) and delegates all other decisions to a parent-based
 * always-on sampler.
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
      if (isNextjsBubbleSpan(spanKind, attributes)) {
        return NOT_RECORD;
      }
      if (isNextjsFrameworkStubSpan(spanKind, attributes)) {
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
      return 'TelemetryHygieneSampler';
    },
  };
}

