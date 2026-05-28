---
name: opentelemetry
description: Instrument Flight School with OpenTelemetry traces, metrics, and logs in line with the OTel GenAI semantic conventions and the Aspire dashboard's OTLP receiver.
---

# OpenTelemetry skill

Use this skill whenever you are adding or modifying observability code in
Flight School — new spans, new histograms, log enrichment, trace
propagation, browser instrumentation, or anything touching the OTLP
exporter wiring.

This skill is **opinionated**: the wider OTel ecosystem offers many ways
to do each of these things, and we have picked one. Deviating without a
reason creates work for every future contributor.

## Provenance

This skill adapts patterns from the following MIT-licensed sources:

- [`cedricziel/claude-otel-plugin`](https://github.com/cedricziel/claude-otel-plugin) — Next.js + browser OTel patterns.
- [`oribarilan/97`](https://github.com/oribarilan/97) `skills/observability/principles.md` — cardinality discipline and golden-signals framing.
- [`rand/cc-polymath`](https://github.com/rand/cc-polymath) `skills/observability/opentelemetry-integration.md` — exporter / sampling reasoning.

Authoritative specs cited throughout:

- OTel GenAI semconv: [`open-telemetry/semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai) — **the canonical home** as of 2025; the GenAI sections under `open-telemetry/semantic-conventions/docs/gen-ai/` are now stubs redirecting here.
- OTel general semconv: [`open-telemetry/semantic-conventions`](https://github.com/open-telemetry/semantic-conventions) — resource, error, exception, HTTP.
- `@vercel/otel` v2.x: [`vercel/otel`](https://github.com/vercel/otel) — `registerOTel` options surface.
- Aspire OTel contract: [`microsoft/aspire`](https://github.com/dotnet/aspire) `src/Aspire.Hosting/OtlpConfigurationExtensions.cs`.

No content has been copied verbatim.

## How telemetry is wired

| Layer | Responsibility | File |
| --- | --- | --- |
| Aspire AppHost | Injects `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`, and short export-interval vars into every child resource on launch. | `apphost.ts` |
| Server SDK (web, Next.js) | `registerOTel(...)` from `@vercel/otel` installs a tracer provider, a meter provider (via `metricReaders`), and a log record provider (via `logRecordProcessors`). The exporters pick up endpoint + protocol from the env vars Aspire injected. | `src/instrumentation.ts` |
| Server SDK (worker, standalone Node) | `NodeSDK` from `@opentelemetry/sdk-node` started via `startWorkerOtel()` from inside `main()` in the worker bootstrap. **Must start before any handler import** so `@opentelemetry/api`, `undici`, and `node:http` are patched before the route graph loads. | `src/worker/lifecycle/otel.ts`, started from `src/worker/bootstrap.ts` |
| Server semconv | Centralised constants for GenAI attribute keys, metric names, instrumentation-scope names. **Do not hard-code these strings anywhere else.** | `src/lib/observability/semconv.ts` |
| Server tracer/meter API | Wrappers like `withSpan`, `recordAiOperation`, `recordAiStreamMetrics`, `recordGitHubOperation`, `recordJobQueueWait`. | `src/lib/observability/telemetry.ts` |
| Browser SDK | `initBrowserOtel()` registers `WebTracerProvider` + `DocumentLoadInstrumentation` + `FetchInstrumentation`; exports JSON over HTTP to a same-origin proxy. | `src/lib/observability/browser-otel.ts` |
| Browser → server proxy | Dual same-origin routes that forward OTLP/JSON to the upstream collector: authenticated `/api/otel/v1/traces` and IP-rate-limited anonymous `/api/otel/v1/traces/anonymous`. Required because the Aspire OTLP receiver is not CORS-enabled for browsers. | `src/app/api/otel/v1/traces/route.ts`, `src/app/api/otel/v1/traces/anonymous/route.ts`, `src/app/api/otel/v1/traces/shared.ts` |
| Context propagation | W3C `traceparent`/`tracestate`/`baggage` flow browser → API → worker → Copilot SDK via helpers in `src/lib/observability/context-propagation.ts`. **Always propagate.** |

## Rules

### 1. Use the right SDK for the runtime

- **Web (Next.js)**: use `@vercel/otel`'s `registerOTel` in
  `src/instrumentation.ts`. Next.js can have edge routes;
  `@opentelemetry/sdk-node` is not edge-safe.
- **Worker (standalone Node)**: use `NodeSDK` from
  `@opentelemetry/sdk-node` in `src/worker/lifecycle/otel.ts`, started
  from `main()` in `src/worker/bootstrap.ts` *before* the handler graph
  loads. The worker is not a Next process and has no edge routes; the
  "no NodeSDK" rule does not apply to it.

### 2. Server instrumentation is opt-in for metrics and logs

`registerOTel({ serviceName })` only installs a **tracer** provider by
default. **Metrics and logs must be explicitly wired** via the
`metricReaders` and `logRecordProcessors` options:

```typescript
registerOTel({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'flight-school',
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
  ],
  logRecordProcessors: [
    new BatchLogRecordProcessor(new OTLPLogExporter()),
  ],
});
```

If you find yourself creating a `meter` or a `logger` and the values
never appear in the Aspire dashboard, **this is the first thing to check.**

### 3. GenAI semantic conventions are mandatory for AI work

Any code that touches an LLM (Copilot SDK, MCP tool calls, evaluation,
hints, authoring) emits spans and metrics using the OpenTelemetry GenAI
semconv. The canonical source is
[`open-telemetry/semantic-conventions-genai`](https://github.com/open-telemetry/semantic-conventions-genai)
— the spec was extracted out of the main semconv repo into a dedicated
one. Everything in the GenAI namespace is currently **Development**
status: there is no stable surface yet, but the spec is mature enough
to ship against and stable enough to commit to in this app.

| Concept | Attribute key | Notes |
| --- | --- | --- |
| Operation kind | `gen_ai.operation.name` | `chat`, `generate_content`, `embeddings`, `invoke_agent`, `create_agent`, `execute_tool`, `retrieval`, `plan`. Use exactly one of the canonical values. |
| Requested model | `gen_ai.request.model` | Exact model name as sent (e.g. `gpt-4o`). |
| Response model | `gen_ai.response.model` | Actual model returned, when available. |
| Provider | `gen_ai.provider.name` | e.g. `github-copilot`, `openai`, `anthropic`, `aws.bedrock`, `gcp.vertex_ai`. **Required** on inference spans and metrics. |
| Token type | `gen_ai.token.type` | `input` or `output`. **Required** on `gen_ai.client.token.usage`. |
| Conversation/session | `gen_ai.conversation.id` | When available. |
| Response id | `gen_ai.response.id` | e.g. `chatcmpl-…`. Recommended. |
| Cache tokens (span attrs) | `gen_ai.usage.cache_read.input_tokens`, `gen_ai.usage.cache_creation.input_tokens` | Capture on spans alongside the `gen_ai.client.token.usage` histogram. |

**Deprecated — do not use**:

- `gen_ai.system` — replaced by `gen_ai.provider.name`.
- The five legacy log events (`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.assistant.message`, `gen_ai.tool.message`, `gen_ai.choice`) — replaced by the consolidated `gen_ai.client.inference.operation.details` event. We do not emit prompt/completion bodies today (privacy/cost); if we ever do, use that event with the Opt-In `gen_ai.input.messages` / `gen_ai.output.messages` attributes.
- `error.message` as a metric or span attribute — unbounded cardinality.

**Span name**: `{gen_ai.operation.name} {gen_ai.request.model}` (e.g.
`chat gpt-4o`). For agent operations, use the agent name instead of the
model: `invoke_agent {gen_ai.agent.name}`.

**Span kind**: `CLIENT` for inference calls (we're calling out to a
provider's API). `INTERNAL` is only correct when the model runs in this
process.

**Errors**: set `SpanStatusCode.ERROR` and add the **stable**
`error.type` attribute (the exception's class name, an HTTP status
string, or a short bounded code). Do **not** invent an `ai.status`
attribute. Do **not** set `error.message` on metrics — see cardinality
rule below.

### 4. Standard GenAI metrics — names, units, bucket boundaries

All GenAI duration histograms use **seconds** (`s`). All token-usage
histograms use the synthetic unit `{token}`.

| Metric | Instrument | Unit | When to record |
| --- | --- | --- | --- |
| `gen_ai.client.operation.duration` | Histogram | `s` | Every AI operation, success or failure. Required. |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | `s` | First streaming delta arrives. **Streaming only**; never report on non-streaming calls. |
| `gen_ai.client.operation.time_per_output_chunk` | Histogram | `s` | Each subsequent streaming chunk. Optional but recommended for richer streaming telemetry. |
| `gen_ai.client.token.usage` | Histogram | `{token}` | When the SDK reports usage. Emit once per non-zero token type: `input`, `output`, `cache_read`, `cache_write`. |

**Don't confuse `time_to_first_chunk` with `time_to_first_token`** — the
latter is the **server-side** counterpart and is reserved for LLM
serving infrastructure, not clients. Client code always uses
`time_to_first_chunk`.

**Recommended histogram bucket boundaries** (from the GenAI spec — apply
via `Views` in `instrumentation.ts` if the SDK defaults don't fit your
data):

- Duration / TTFC / time-per-chunk: `[0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92]`
- Token usage: `[1, 4, 16, 64, 256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864]`

**Units are seconds, not milliseconds.** Do not record `*_ms`. Convert
before recording.

### 4a. GenAI semconv stability opt-in

The GenAI spec defines `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`
as the migration toggle. We are already on the latest conventions
(`gen_ai.provider.name`, consolidated event model), so no opt-in is
needed in our code. If a future Copilot SDK update emits the **old**
conventions internally, do not turn this opt-in on globally — wrap or
remap at our integration layer instead.

### 5. Custom app metrics live under `flight_school.*`

Anything without a standard equivalent uses the `flight_school.*` prefix:
`flight_school.jobs.queue_wait`, `flight_school.ai.stream.delta_count`,
etc. Document each new metric in this file's "Custom metrics" table when
you add one.

### 6. Cardinality discipline

Attribute keys that go on **metrics** must have bounded value sets. The
following are **forbidden** as metric labels (they belong on spans/logs):

- `user_id`, `session_id`, `correlation_id`, `request_id`, `trace_id`, `span_id`
- raw URLs containing IDs or query strings — use route templates (e.g. `/api/repos/:owner/:repo`)
- free-form strings (error messages, user input, model output)
- `error.message`, `exception.message` — the spec explicitly deprecates these as metric/span attributes (unbounded)

Spans and log records are sampled and richly-attributed; metrics are
aggregated and must stay low-cardinality. The OTel SDK enforces a
default cardinality limit of **2000 data points per instrument per
collection cycle**; once exceeded, additional series are folded into a
single `otel.metric.overflow=true` data point and your dashboards lie.
If a metric needs more than ~50 distinct attribute combinations,
question the design.

For new public-facing metrics, prefer an explicit allowlist via
`Views[].attributeKeys` in `instrumentation.ts` to guarantee unknown
attributes can't leak in.

### 7. Instrumentation-scope names

Two scope names exist; both are exported as constants from
`src/lib/observability/semconv.ts`:

- `flight-school.observability` — server-side tracer and meter.
- `flight-school.browser` — every browser-side tracer.

Do not pass other strings to `trace.getTracer()` or `metrics.getMeter()`.

### 8. Browser instrumentation set is fixed

Use exactly:

```
@opentelemetry/sdk-trace-web
@opentelemetry/context-zone
@opentelemetry/exporter-trace-otlp-http
@opentelemetry/instrumentation
@opentelemetry/instrumentation-document-load
@opentelemetry/instrumentation-fetch
```

Do **not** add `@opentelemetry/instrumentation-http`, `instrumentation-undici`,
or the auto-instrumentations meta-package on the browser. Do **not** try
to wire `@opentelemetry/sdk-metrics` on the browser — its browser support
is incomplete and we emit no browser-side metrics.

### 9. Browser exports go to the same-origin proxy

The browser exporter chooses a same-origin proxy route at bootstrap:
`/api/otel/v1/traces` when an Auth.js session cookie exists, otherwise
`/api/otel/v1/traces/anonymous`. The anonymous route is strictly
rate-limited per client IP. **Never** point the browser exporter at the
Aspire OTLP endpoint directly — CORS will fail and exposing collector
credentials to the browser is unacceptable.

The exporter is configured with `fetchOptions: { keepalive: true }` so
the final batch survives `pagehide` / `beforeunload`. Without this the
last `page.view` span and any pending children are silently dropped
when the user navigates away or closes the tab.

### 9a. Browser traces have one root per route: the `page.view` span

The browser SDK runs a long-lived `page.view` span that acts as the
**parent for every fetch and component-mount span emitted while that
route is active**. Without it, each mount-time `useEffect` fetch becomes
its own root span and the dashboard shows ~10 unrelated traces for a
single page load.

How the lifecycle works (see
[`src/lib/observability/route-tracking.ts`](../../../src/lib/observability/route-tracking.ts)
and [`src/lib/observability/browser-otel.ts`](../../../src/lib/observability/browser-otel.ts)):

1. **Module-eval bootstrap.** `BrowserOtelBootstrap.tsx` calls
   `initBrowserOtel()` at module-evaluation time (not inside a `useEffect`).
   This runs **before any component renders**, beating React's
   parent-effects-fire-after-child-effects ordering invariant. A child
   `useEffect` fetch would otherwise mis-parent to whatever span happened
   to be active.
2. **History patching.** `installRouteTracking()` monkey-patches
   `history.pushState`, `history.replaceState`, and listens to `popstate`.
   App Router's `router.push` calls `pushState`, so route transitions are
   driven **synchronously, outside React**. Patched functions are tagged
   with `Symbol.for('flight-school.route-tracking.patched')` for HMR
   idempotency.
3. **Span lifecycle.** A `page.view` span starts on route enter and ends
   on the next route change or on `pagehide`. While it's active, our
   `window.fetch` wrapper sets it as the active OTel context before
   delegating to the original fetch, so `FetchInstrumentation` reads it
   as the parent.
4. **Visibility vs unload.** `visibilitychange === 'hidden'` calls
   `forceFlush()` but does **not** end the span (the user may return).
   `pagehide` ends the span. Mobile browsers don't fire `beforeunload`
   reliably — we use `pagehide` instead.

**Don't** add a parallel "navigation span" or use `useEffect(usePathname)`
to start a span — both have been tried and both lose the race against
child effects.

**Don't** wrap `window.fetch` from anywhere except `initBrowserOtel`. The
wrap is idempotent via a `Symbol.for` marker; a second wrap from another
module would either no-op (best case) or stack and double-count
(worst case).

**Fetch span names use the URL pathname** (`GET /api/focus` not
`HTTP GET`) — set by an `applyCustomAttributesOnSpan` hook that calls
`span.updateName(...)` after sanitising the URL via
`extractPathname()`. If you add a new browser instrumentation, mirror
this pattern.

**Live trace-list ergonomics caveat.** `BatchSpanProcessor` only exports
ended spans, and `page.view` deliberately lives for the whole route.
Child fetches export first; the parent exports later. The Aspire OTLP
collector links them retroactively by `traceId`, but in the dashboard's
live list you'll briefly see children before their parent. This is not
a bug — refresh after the route ends and the tree is complete.
`initBrowserOtel()` configures the browser `BatchSpanProcessor` with
`maxQueueSize: 100` and `scheduledDelayMillis: 5000`
([`src/lib/observability/browser-otel.ts`](../../../src/lib/observability/browser-otel.ts))
to keep browser OTLP export request volume bounded and avoid chatty
per-navigation export bursts.

### 10. Always propagate trace context across boundaries

Every outbound fetch from server code that crosses a service boundary
(worker, GitHub MCP, Copilot SDK calls we control) must inject the active
`traceparent`. Use `captureTracePropagationHeaders()` and
`mergeTracePropagationHeaders()` from `context-propagation.ts`. Every
inbound API route must extract via `withExtractedTraceContext()`.

### 11. Logs carry `trace_id` / `span_id`

Server logs are bridged to the OTel logs API in `src/lib/logger.ts` via
`@opentelemetry/api-logs`. Because the OTel JS SDK propagates active
context through `AsyncLocalStorage`, `trace_id` and `span_id` are
**attached automatically** to every `LogRecord` emitted from inside an
active span — the logger does not (and should not) set them manually
on the record.

Don't bypass the `logger` (no raw `console.log` in business logic). If
you add a new logging sink, route it through the existing `Logger`
class so trace correlation, severity mapping, and OTel bridging are
preserved.

The OTel spec is also migrating exception capture from span events into
log records (`OTEL_SEMCONV_EXCEPTION_SIGNAL_OPT_IN=logs`). We do not
opt in yet — keep using `span.recordException(err)` plus
`error.type`. Revisit when the JS SDK marks logs Stable.

### 12. Aspire env vars are the contract

Aspire's DCP injects these into every child resource automatically when
the resource is added via the JavaScript hosting extensions
(`addNextJsApp`, `addNodeApp`, …). The C# chain
`WithNodeDefaults → WithOtlpExporter` does this transparently — you do
not (and cannot) call `withOtlpExporter()` from the TypeScript AppHost.

Always injected:

- `OTEL_SERVICE_NAME` — the resource's logical name.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — gRPC or HTTP, whichever the dashboard exposes.
- `OTEL_EXPORTER_OTLP_PROTOCOL` — `grpc` or `http/protobuf`, matched to the endpoint type. **This project uses `http/protobuf`** because `aspire.config.json` sets `ASPIRE_DASHBOARD_OTLP_HTTP_ENDPOINT_URL`.
- `OTEL_EXPORTER_OTLP_HEADERS` — includes `x-otlp-api-key=…` when the dashboard runs in API-key auth mode (default).
- `OTEL_RESOURCE_ATTRIBUTES` — at minimum `service.instance.id={uuid}`.

Injected only in `IsDevelopment()` mode:

- `OTEL_BSP_SCHEDULE_DELAY=1000` — span batch flush every 1s instead of 5s.
- `OTEL_BLRP_SCHEDULE_DELAY=1000` — log batch flush every 1s.
- `OTEL_METRIC_EXPORT_INTERVAL=1000` — metric export every 1s instead of 60s.
- `OTEL_TRACES_SAMPLER=always_on` — sample everything in dev.
- `OTEL_METRICS_EXEMPLAR_FILTER=trace_based` — emit metric exemplars linking to active spans (the dashboard renders these as clickable dots on metric charts).

Read only the variables in the "always injected" list from app code. Do
**not** invent app-specific env vars to route telemetry. If Aspire's
contract isn't enough, fix it in `apphost.ts` via `withEnvironment(...)`.

### 13. Known Next.js + OTel gotchas

- The `experimental.instrumentationHook` flag is gone in Next.js ≥ 15 — do not set it.
- **Duplicate fetch spans**: `@vercel/otel` v2's default
  `instrumentations: ["auto"]` installs `FetchInstrumentation`, and
  Next.js's built-in tracer **also** emits `AppRender.fetch` spans for
  every server-side `fetch()`. Set **`NEXT_OTEL_FETCH_DISABLED=1`** on
  the **Next.js web resource** in `apphost.ts` (via `withEnvironment`)
  to suppress Next.js's built-in span and keep only the richer
  `FetchInstrumentation` span. Without this every server fetch is
  double-counted. The worker is no longer a Next.js app, so this var
  is intentionally absent from the worker resource.
- App Router route handlers (`app/api/.../route.ts`) automatically set
  `http.route`. Pages Router and middleware do not — set it explicitly
  if you ever add one of those.
- Resource attribute merge order: `OTEL_RESOURCE_ATTRIBUTES` (from
  Aspire, picked up by the env detector) **wins over** the Vercel
  defaults `@vercel/otel` adds, which **win over** the `attributes`
  field you pass to `registerOTel`. If a `vercel.*` attribute needs to
  disappear, drop it explicitly.

### 14. Resource attributes we set

The Aspire env detector populates `service.name` and `service.instance.id`
from `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES`. On top of that,
ensure these on the server resource:

- `service.version` — read from `INSTRUMENTATION_SCOPE_VERSION` (which
  tracks the app version).
- `deployment.environment.name` — note the `.name` suffix (the old
  `deployment.environment` is deprecated). Read from `NODE_ENV` or set
  explicitly in `apphost.ts` per environment.

The browser resource sets `service.name=flight-school-browser` and
`service.version` so the dashboard groups browser telemetry as its own
resource alongside the server.

### 14a. Service-tier naming — how to tell who emitted a span

A trace can originate in three logical tiers, but only two of those
tiers map cleanly to a process. The Next.js process serves **both**
page renders and API route handlers — same Node runtime, same OTel SDK,
same `service.name`. That's a fact of Next.js, not a deficiency.

| Logical tier | What it does | How to identify it in a trace |
| --- | --- | --- |
| **Browser** | All client JS — fetches, navigations, document load | `service.name=flight-school-browser` (resource attribute) |
| **API layer** | App Router route handlers under `app/api/**/route.ts` | `service.name=flight-school-web` **AND** `http.route` starts with `/api/` |
| **Page render** | App Router pages, RSC, server components | `service.name=flight-school-web` **AND** `http.route` does **not** start with `/api/` |
| **Worker** | Background queue consumer | `service.name=flight-school-worker` |

**Recommended dashboard filters:**

- "All browser activity" → filter `service.name = flight-school-browser`.
- "All API calls" → filter `service.name = flight-school-web` **and** `http.route =~ ^/api/`.
- "All page renders" → filter `service.name = flight-school-web` **and** `http.route !~ ^/api/`.
- "All worker activity" → filter `service.name = flight-school-worker`.

**Why we don't split `flight-school-web` into two services.** It's
genuinely one Node process. The OTel HTTP semconv puts `http.route` on
every server span specifically so dashboards can slice the same service
along route patterns without inventing fake services. Splitting would
require either a second Next.js process (doubles cold-start cost) or
lying about reality (one process, two `service.name`s — confuses
exemplar linking and resource queries). `http.route` is the paved path.

**Why we don't (currently) add a `flight_school.tier` span attribute.**
Tempting, but it would duplicate `http.route` — the dashboard can
already filter on the prefix. The day we want tier in **metric** labels
(low-cardinality counters of API vs page work), that's the point to add
a `Views` mapping that derives `flight_school.tier ∈ {api, page}` from
`http.route` and drops the raw route, since the raw route is unbounded
cardinality for metrics. Don't add it speculatively.

**Naming nit.** `flight-school-web` is slightly ambiguous — it's the
Next.js process, not "the website". If a future rename makes things
clearer, `flight-school-nextjs` is the better service name. Until then,
remember: `web` = "the Next.js process that does both pages and API",
filtered apart by `http.route`.

### 15. Browser telemetry: traces only, by design

The same-origin proxy routes (`/api/otel/v1/traces` and
`/api/otel/v1/traces/anonymous`) forward **traces only**.
Browser-side metrics and logs are intentionally not collected:

- The OTel JS SDK metrics surface is incomplete on the browser.
- Most browser-side counters we'd want (page views, errors, user
  interactions) are better captured as span events on document-load and
  navigation spans, which we already emit.
- Forwarding browser logs would mean either trusting client-supplied
  trace context or breaking trace correlation — neither is acceptable.

If you need a new browser metric, prefer adding a span event or
attribute to an existing browser span. Do not wire `sdk-metrics` or
`sdk-logs` on the browser without a written design.

### 16. Suppress the OTel-proxy self-tracing feedback loop

The browser BSP flushes pending spans on `document.visibilitychange`, so
every tab switch POSTs to `/api/otel/v1/traces`. Without intervention,
`@vercel/otel`'s server-side auto-instrumentation traces *that* POST,
producing four spans per export (`POST`, `POST /api/otel/v1/traces`,
`resolve page components`, `executing api route (app) /api/otel/v1/traces`).
On a quiet app these self-spans drown out real telemetry on the dashboard.

The fix is a `traceSampler` that drops spans whose name or attributes
identify the proxy route. The unsampled root propagates `NOT_RECORD` to
its children via the standard parent-based chain, so all four spans
disappear together:

```ts
// src/instrumentation.ts
import { createTelemetryHygieneSampler } from '@/lib/observability/proxy-sampler';

registerOTel({
  // ...
  traceSampler: createTelemetryHygieneSampler(),
});
```

The sampler matches the proxy-route prefix (`/api/otel/v1/traces`) across
`spanName`, `http.target`, `url.path`, and `http.route` because those
attributes are populated at different stages of the request lifecycle
(HTTP instrumentation sets `http.target` / `url.path` at span creation;
Next.js sets `http.route` later, once the route has matched).

Do **not** "fix" this by disabling the browser BSP's visibilitychange
flush — losing spans when a tab is backgrounded is worse than a few
self-spans, and the sampler closes the loop completely without that
trade-off.

## Red flags to call out in review

- A new `tracer.startSpan` without `try/finally`/`span.end()`.
- A new metric name not under `gen_ai.*`, `flight_school.*`, or the OTel HTTP/RPC/DB semconv.
- Any `setAttribute('ai.*', …)` — should be `gen_ai.*`.
- Any `gen_ai.system` attribute — deprecated; use `gen_ai.provider.name`.
- Any of the deprecated GenAI log events (`gen_ai.system.message`, `gen_ai.user.message`, etc.) — use `gen_ai.client.inference.operation.details` if we ever capture bodies.
- A duration metric or attribute with `_ms` suffix — units must be seconds.
- A metric label that could equal `userId`, `correlationId`, `traceId`, a raw URL, `error.message`, or any unbounded string.
- A new `trace.getTracer('something-custom')` — use the scope constants from `semconv.ts`.
- An outbound fetch (server-side) that doesn't merge the propagation headers.
- A new logger call via `console.*` directly.
- Anything that reads `process.env.OTEL_*` outside `instrumentation.ts` or the OTLP proxy route — the SDK consumes those; app code shouldn't.

## Custom metrics registry

When you add a new `flight_school.*` metric, append a row here:

| Metric | Instrument | Unit | Attributes (and expected cardinality) | Defined in |
| --- | --- | --- | --- | --- |
| `flight_school.jobs.queue_wait` | Histogram | `s` | `job.type` (bounded) | `telemetry.ts` |
| `flight_school.ai.stream.delta_count` | Histogram | `{delta}` | `gen_ai.request.model`, `ai.mcp_enabled`, `ai.pool_hit`, `ai.stream.terminal_state` | `telemetry.ts` |
| `flight_school.ai.stream.delta_bytes` | Histogram | `By` | same as above | `telemetry.ts` |
| `flight_school.ai.stream.tool_calls` | Counter | `{call}` | same as above | `telemetry.ts` |

## Smoke checklist after non-trivial OTel changes

1. `aspire run` and open the dashboard.
2. **Metrics view** — every metric you touched is present with the expected name and unit.
3. **Traces view** — exercise the changed code path; spans carry the GenAI attributes; no duplicate `fetch` spans.
4. **Structured Logs view** — recent logs carry a `trace_id`/`span_id` that matches a trace.
5. `npm test` passes — telemetry unit tests assert names and attribute keys.
