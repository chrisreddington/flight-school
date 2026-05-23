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

No content has been copied verbatim.

## How telemetry is wired

| Layer | Responsibility | File |
| --- | --- | --- |
| Aspire AppHost | Injects `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_RESOURCE_ATTRIBUTES`, and short export-interval vars into every child resource on launch. | `apphost.ts` |
| Server SDK | `registerOTel(...)` from `@vercel/otel` installs a tracer provider, a meter provider (via `metricReaders`), and a log record provider (via `logRecordProcessors`). The exporters pick up endpoint + protocol from the env vars Aspire injected. | `src/instrumentation.ts` |
| Server semconv | Centralised constants for GenAI attribute keys, metric names, instrumentation-scope names. **Do not hard-code these strings anywhere else.** | `src/lib/observability/semconv.ts` |
| Server tracer/meter API | Wrappers like `withSpan`, `recordAiOperation`, `recordAiStreamMetrics`, `recordGitHubOperation`, `recordJobQueueWait`. | `src/lib/observability/telemetry.ts` |
| Browser SDK | `initBrowserOtel()` registers `WebTracerProvider` + `DocumentLoadInstrumentation` + `FetchInstrumentation`; exports JSON over HTTP to a same-origin proxy. | `src/lib/observability/browser-otel.ts` |
| Browser → server proxy | Auth-gated route at `/api/otel/v1/traces` that forwards OTLP/JSON to the upstream collector. Required because the Aspire OTLP receiver is not CORS-enabled for browsers. | `src/app/api/otel/v1/traces/route.ts` |
| Context propagation | W3C `traceparent`/`tracestate`/`baggage` flow browser → API → worker → Copilot SDK via helpers in `src/lib/observability/context-propagation.ts`. **Always propagate.** |

## Rules

### 1. Use `@vercel/otel`, not `NodeSDK`

Next.js can have edge routes; `@opentelemetry/sdk-node` is not edge-safe.
`@vercel/otel`'s `registerOTel` is. Stay on it.

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
semconv ([spec](https://opentelemetry.io/docs/specs/semconv/gen-ai/)).

| Concept | Attribute key | Notes |
| --- | --- | --- |
| Operation kind | `gen_ai.operation.name` | `chat`, `generate_content`, `embeddings`, `invoke_agent`, `execute_tool`. |
| Requested model | `gen_ai.request.model` | Exact model name as sent (e.g. `gpt-4o`). |
| Response model | `gen_ai.response.model` | Actual model returned, when available. |
| Provider | `gen_ai.provider.name` | e.g. `github-copilot`, `anthropic`. Required on inference spans. |
| Token type | `gen_ai.token.type` | `input` or `output`. Required on `gen_ai.client.token.usage`. |

**Span name**: `{gen_ai.operation.name} {gen_ai.request.model}` (e.g. `chat gpt-4o`).
**Errors**: set `SpanStatusCode.ERROR` and add `error.type` — do **not**
invent an `ai.status` attribute.

### 4. Standard GenAI metrics — names and units

| Metric | Instrument | Unit | When to record |
| --- | --- | --- | --- |
| `gen_ai.client.operation.duration` | Histogram | `s` (seconds) | Every AI operation, success or failure. |
| `gen_ai.client.operation.time_to_first_chunk` | Histogram | `s` | First streaming delta. |
| `gen_ai.client.token.usage` | Histogram | `{token}` | When the SDK reports an `assistant.usage` event. Emit once with `gen_ai.token.type=input`, once with `output`. |

**Units are seconds, not milliseconds.** Do not record `*_ms`. Convert
before recording.

### 5. Custom app metrics live under `flight_school.*`

Anything without a standard equivalent uses the `flight_school.*` prefix:
`flight_school.jobs.queue_wait`, `flight_school.ai.stream.delta_count`,
etc. Document each new metric in this file's "Custom metrics" table when
you add one.

### 6. Cardinality discipline

Attribute keys that go on **metrics** must have bounded value sets. The
following are **forbidden** as metric labels (they belong on spans/logs):

- `user_id`, `session_id`, `correlation_id`, `request_id`
- raw URLs containing IDs or query strings — use route templates (e.g. `/api/repos/:owner/:repo`)
- free-form strings (error messages, user input, model output)

Spans and log records are sampled and richly-attributed; metrics are
aggregated and must stay low-cardinality.

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

The browser exporter URL is `/api/otel/v1/traces`. The proxy is
auth-gated; pre-auth document-load spans will be dropped, and that is
acceptable. **Never** point the browser exporter at the Aspire OTLP
endpoint directly — CORS will fail and exposing collector credentials
to the browser is unacceptable.

### 10. Always propagate trace context across boundaries

Every outbound fetch from server code that crosses a service boundary
(worker, GitHub MCP, Copilot SDK calls we control) must inject the active
`traceparent`. Use `captureTracePropagationHeaders()` and
`mergeTracePropagationHeaders()` from `context-propagation.ts`. Every
inbound API route must extract via `withExtractedTraceContext()`.

### 11. Logs carry `trace_id` / `span_id`

`src/lib/logger.ts` enriches every log record with the active trace
context via `getActiveTraceContext()`. Don't bypass it (no raw
`console.log` in business logic). If you add a new logging sink, route
it through the existing `Logger` class so trace correlation is
preserved.

### 12. Aspire env vars are the contract

Read only these from the environment:

- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OTEL_EXPORTER_OTLP_HEADERS`
- `OTEL_EXPORTER_OTLP_PROTOCOL` (default `http/protobuf`)
- `OTEL_RESOURCE_ATTRIBUTES`
- `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` (only if changing sampler)

Do **not** invent app-specific env vars to route telemetry. If Aspire's
contract isn't enough, fix it in `apphost.ts` via `withEnvironment(...)`.

### 13. Known Next.js + OTel gotchas

- The `experimental.instrumentationHook` flag is gone in Next.js ≥ 15 — do not set it.
- Next.js auto-creates `fetch <method> <url>` spans. If you ever add
  `@opentelemetry/instrumentation-undici` server-side you will get
  duplicates; set `NEXT_OTEL_FETCH_DISABLED=1` if so.
- App Router route handlers (`app/api/.../route.ts`) automatically set
  `http.route`. Pages Router and middleware do not — set it explicitly
  if you ever add one of those.

## Red flags to call out in review

- A new `tracer.startSpan` without `try/finally`/`span.end()`.
- A new metric name not under `gen_ai.*`, `flight_school.*`, or the OTel HTTP semconv.
- Any `setAttribute('ai.*', …)` — should be `gen_ai.*`.
- Any metric label that could equal `userId`, `correlationId`, a raw URL, or an unbounded string.
- A new `trace.getTracer('something-custom')` — use the scope constants.
- An outbound fetch (server-side) that doesn't merge the propagation headers.
- A new logger call via `console.*` directly.

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
