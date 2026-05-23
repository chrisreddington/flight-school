# Plan: End-to-end Streaming Observability & Resumable Jobs

**Status:** Proposed
**Owner:** Platform
**Scope:** Browser → API → Worker → Copilot SDK → storage
**Non-goals:** Replacing the file-backed storage primitive, swapping the worker
transport, or changing the multi-tenant auth model.

---

## 0. Problem statement

Today the streaming pipeline is correct but opaque and tied to polling:

1. The web tier writes a stream's deltas into a *scratchpad JSON file* every
   ~400 ms (`src/lib/storage/scratchpad.ts`). The client polls
   `GET /api/threads/storage` every 400 ms and the route hydrates threads
   with the scratchpad via `transformRead`. There is no SSE, no resumable
   cursor, no ordering primitive other than "last write wins on a full string".
2. The worker runs jobs over plain HTTP (`/api/internal/jobs/execute`) with
   `traceparent` forwarded, but the streaming loop emits no per-chunk
   telemetry — one `recordAiOperation('streamSession', …)` summary on close
   and a single AI duration histogram is all we get.
3. There is no client OTel SDK. We can correlate a `POST /api/jobs` to a
   worker span via `traceparent`, but we cannot answer "where did the 8
   seconds go" — queue wait vs. SDK init vs. first model token vs. tool call
   vs. disk flush vs. client paint are all collapsed into one envelope.
4. Resume across navigation works *by accident*: the polling hook detects
   `isStreaming` after threads reload. There is no append-only event log,
   no monotonic offset, and no way for a re-mounted client to subscribe to
   the live tail without polling the whole threads doc.

This plan fixes all three: a resumable stream-buffer architecture, an
opinionated OTel span/event design for AI streaming, page-level frontend
telemetry, a latency-attribution playbook, and a phased migration.

---

## 1. Target architecture for stream state & resume semantics

### 1.1 Storage model: append-only event log + projection

Replace the single scratchpad blob with a two-tier model:

```
users/{userId}/jobs/{jobId}/events.ndjson   (append-only, monotonic)
users/{userId}/jobs/{jobId}/snapshot.json   (projected state, rewritten)
```

**Event log** (`events.ndjson`):

- One JSON line per event. Schema:
  ```ts
  {
    seq: number,            // monotonic, contiguous, starts at 1
    ts: string,             // ISO-8601
    type:
      | 'stream.started'
      | 'delta'
      | 'tool.start'
      | 'tool.complete'
      | 'heartbeat'
      | 'stream.completed'
      | 'stream.failed'
      | 'stream.cancelled',
    payload: { ... },
    traceparent?: string,   // span context at the time of emission
  }
  ```
- The executor appends with `fs.appendFile` + `fsync` on terminal events.
  Append-only writes are crash-safe and avoid the read-modify-write tax of
  the current scratchpad approach.
- `seq` is the only ordering primitive clients ever see. Wall-clock `ts`
  is for diagnostics only.

**Snapshot** (`snapshot.json`):

- Materialised projection (current text, tool events, status, `lastSeq`).
  Rewritten on terminal state, plus a debounced "every 1 s while streaming"
  tick so cold readers don't have to replay 10k deltas.
- Hydration path for `GET /api/threads/storage` reads `snapshot.json` for
  in-flight messages, exactly replacing the current scratchpad hydration.

**Why an event log over chunk-writes-to-storage:**

- *Ordering & idempotency are free.* `seq` lets every consumer
  (client, projector, replay tooling) reason about exactly-once application
  with a trivial `lastAppliedSeq` cursor.
- *Reconnect is a range query.* `GET /api/jobs/{id}/events?fromSeq=N`
  returns everything after the client's cursor; the client never needs to
  re-fetch the whole thread to catch up.
- *Backpressure is local.* Producer never blocks on consumers; consumers
  pull at their own rate. The current polling design already gives us
  poll-rate backpressure for free; SSE keeps that property.
- *Future-proof.* Same shape works whether the backend is files, SQLite,
  or a real broker. Migrating the storage primitive becomes a `Projector`
  swap, not a protocol change.
- *Debuggability.* A failed stream leaves the full event tape on disk;
  today a failed scratchpad gives you a partial blob with no causation.

### 1.2 Wire protocol: SSE with resume

Replace the 400 ms threads polling with Server-Sent Events:

```
GET /api/jobs/{id}/stream
  Headers:
    Last-Event-ID: <seq>          (browser auto-sends on reconnect)
    Accept: text/event-stream
  Response: text/event-stream
    id: <seq>
    event: delta | tool.start | tool.complete | heartbeat | done | error
    data: <json payload>
```

Semantics:

- **Idempotency.** Endpoint is keyed on `(userId, jobId)`; ownership check
  identical to existing `/api/jobs/{id}` GET (404 on cross-tenant). Multiple
  tabs can subscribe; the executor doesn't care.
- **Ordering.** Server emits in `seq` order from the log. `id:` field on
  every SSE event carries `seq`; client gets free auto-resume via
  `Last-Event-ID`.
- **Reconnection.** On reconnect, server reads `Last-Event-ID`, opens the
  log file, seeks past `seq`, replays the tail, then tails. If the job has
  terminated and the client is fully caught up, the server emits `done`
  and closes.
- **Backpressure.** Server uses a bounded ring buffer per connection
  (e.g. 256 events). On overflow, server drops the connection with a
  `Retry-After: 0`; the client reconnects with `Last-Event-ID` and replays
  from the log — same code path as cold resume. No silent message loss.
- **Heartbeats.** Executor emits a `heartbeat` event every 2 s while
  the SDK stream is open. Server forwards as SSE comment lines
  (`:keepalive`) so proxies don't time out, plus an actual `heartbeat`
  event with `seq` so clients can prove liveness.
- **Cross-navigation resume.** Pages unmount the `EventSource`; pages that
  remount with a known `jobId` reopen with `Last-Event-ID = lastAppliedSeq`
  from local state. The hook owns "is there a job for this thread?" via
  the existing `getActiveChatJobForThread`-style lookup.

### 1.3 Job lifecycle changes

- **Web tier (`POST /api/jobs`).** Unchanged contract; idempotency key
  remains `(userId, threadId, assistantMessageId)`. On accept, it now
  *also* writes a `stream.started` event with `seq: 1` to the log so the
  client can begin a useful SSE subscription before the worker has even
  acked the dispatch.
- **Worker executor (`executeChatResponse`).** Replace
  `flushScratchpad`/`consolidateToThread` with `appendEvent` + a
  debounced `projectSnapshot`. On terminal, project once more and write
  the canonical message into `threads.json` (existing
  `updateThread` path).
- **Cancellation.** `DELETE /api/jobs/{id}` keeps current semantics; it now
  also writes a `stream.cancelled` event so any subscribed SSE client
  receives a clean terminal frame.
- **Server restart.** Existing `instrumentation.ts` sweep marks
  pending/running as failed; we additionally append a `stream.failed`
  event with `reason: 'server-restart'` for any orphaned log, then move
  the log under `users/{userId}/jobs/_archive/` so retention can sweep
  it.

### 1.4 Why not direct chunk writes to threads.json (the current model)

It is the right primitive *only* for one writer + one polling reader on a
local filesystem. It breaks the moment we want any of:

- Multi-tab subscription (today: both tabs poll the whole file).
- Re-projection (e.g. future "show tool call timeline" view).
- Replay-on-incident (current scratchpad is overwritten, not appended).
- Swapping storage backends without changing the wire contract.

The append-log + projection pattern keeps the file-backed primitive (no
new infra) while removing all four limitations. Adopt it.

---

## 2. OTel span / event design for AI streaming

Principle: **never keep a long-lived span for the duration of a stream.**
A 60 s root span is opaque, hard to sample, and impossible to correlate
across reconnects. Use a short root + linked child spans + span events
for chunk-level signals.

### 2.1 Span topology

```
[client] page.navigation                  (root, RUM-style, ≤ TTI)
   └─ link → api.POST /api/jobs           (HTTP server span, ≤500ms)
                ├─ jobs.enqueue           (span, child)
                │     events:
                │       jobs.idempotency.hit | jobs.idempotency.miss
                │       jobs.token_store.seed.{ok|fail}
                └─ jobs.dispatch.http     (HTTP client span; links job_id)
                      ↓
[worker] http.POST /api/internal/jobs/execute        (HTTP server span)
   └─ job.execute                                    (root for the job;
                                                      attrs: ai.job.id,
                                                      ai.job.type, user.id)
         ├─ job.repository_context        (short, optional)
         ├─ copilot.session.create        (attrs: pool.hit, model,
         │                                  mcp.enabled, session.create_ms)
         ├─ ai.stream                     (span; ends at SDK idle/error;
         │     attrs:
         │        ai.model, ai.tools.count,
         │        ai.stream.first_delta_ms,
         │        ai.stream.duration_ms,
         │        ai.stream.deltas, ai.stream.bytes,
         │        ai.stream.tool_calls,
         │        ai.stream.terminal_state
         │     events:
         │        stream.started (seq=1)
         │        first_token   (seq=N)        ← attr: ms_since_span_start
         │        tool.start (per call; name, args.bytes)
         │        tool.complete (duration_ms, result.bytes)
         │        backpressure.dropped (count)  (optional)
         │        stream.completed | stream.failed | stream.cancelled
         │     NB: deltas are NOT span events — too high-cardinality.
         │         Aggregate via attrs + the metrics in §2.3.
         │ )
         ├─ projector.snapshot           (debounced, short-lived)
         └─ job.persist                  (final consolidation to threads.json)

[client] sse.subscribe                    (one short span per connection
                                            life; links job.execute by
                                            traceparent on `stream.started`)
```

Key rules:

- `ai.stream` is the *only* span that wraps the SDK streaming loop, and it
  ends on idle/error. It is bounded by SDK lifetime, not by the entire
  job (which may continue with persistence work).
- Tool calls are **events on `ai.stream`**, not separate spans, unless the
  tool actually performs network/IO we want to time independently; for
  MCP tools we *do* want them as child spans (`mcp.tool` with attrs
  `tool.name`, `tool.duration_ms`, `tool.result.bytes`) because they have
  their own latency budget. The `tool.start` / `tool.complete` events on
  `ai.stream` then carry the child span's `span_id` for correlation.
- Per-delta events are forbidden as span events. Cardinality kills span
  size. Use the metrics in §2.3.
- The `job.execute` root span gets a **`span link`** to the originating
  client `interaction` span (carried via `traceparent` in `causality`),
  so traces are joined even though they are separate trace IDs from the
  worker's perspective.

### 2.2 Span events vs. log records

Use span events for **state transitions** (≤20 per stream), use log
records (already in `logger`) for everything else. Anything you'd consider
emitting more than once per second per stream is a metric, not a span
event.

### 2.3 Metrics (OTLP, names use `flight_school.ai.stream.*`)

Add to `src/lib/observability/telemetry.ts`:

- `flight_school.ai.stream.first_token_ms` — histogram; attrs:
  `ai.model`, `mcp.enabled`, `pool.hit`.
- `flight_school.ai.stream.duration_ms` — histogram; attrs as above plus
  `terminal_state`.
- `flight_school.ai.stream.delta_count` — histogram (per stream).
- `flight_school.ai.stream.delta_bytes` — histogram (per stream).
- `flight_school.ai.stream.tokens_per_second` — histogram derived at
  stream close.
- `flight_school.ai.stream.tool_calls` — counter; attrs:
  `tool.name`, `outcome`.
- `flight_school.ai.stream.tool_latency_ms` — histogram.
- `flight_school.jobs.queue_wait_ms` — histogram; measured as
  `worker.span.start - jobs.create.span.start`. **This is the metric that
  answers "is the worker the bottleneck"; we have nothing equivalent
  today.**
- `flight_school.jobs.dispatch_http_ms` — histogram.
- `flight_school.jobs.persist_ms` — histogram.
- `flight_school.sse.connections.active` — up-down counter; attrs:
  `route`.
- `flight_school.sse.replayed_events` — counter; tags `reason`
  (`reconnect`, `cold_start`).

Keep the existing `flight_school.ai.duration_ms` for backwards compat;
add the streaming-specific metrics alongside.

### 2.4 Attribute hygiene

- Always set `user.id` as the **hashed** id used by the audit log
  (`AUDIT_SALT`), never the raw GitHub login. The session-id partitioning
  in `getConversationSession` already enforces tenant isolation; the
  span attribute is for joining traces to audit, not for IAM.
- Never put prompt content, tool arguments, or model output in span
  attributes. Use `*.bytes` and `*.count`. Prompt content can go to
  activity-logger only (already redacted there).
- All new attrs use `ai.*`, `mcp.*`, `jobs.*`, `sse.*` prefixes — keep
  vendor-neutral so OTel semconv evolutions don't force renames.

---

## 3. Page-level frontend telemetry plan

### 3.1 Goal

Correlate a user pressing "Send" on the chat composer with the SSE event
that delivers their first token, across page navigations, with one trace.

### 3.2 Approach: browser OTel SDK + W3C trace context

Add `@opentelemetry/sdk-trace-web` + `@opentelemetry/instrumentation-fetch`
+ `@opentelemetry/instrumentation-document-load`
+ `@opentelemetry/instrumentation-user-interaction` in a *client* bundle
loaded from `src/app/providers.tsx`.

Configure:

- **Service name:** `flight-school-web`.
- **Sampler:** parent-based, 10% head sampling, override to 100% when
  the user has the debug cookie/flag.
- **Exporter:** OTLP/HTTP to a same-origin Next.js route
  (`/api/internal/otlp/v1/traces`) that forwards to the configured
  collector. Same-origin keeps it auth-friendly and avoids CORS.
- **Resource attributes:** `app.deploy.commit`, `app.deploy.env`,
  `browser.name`, `browser.version`, `app.user.id` (hashed).

### 3.3 Span topology on the client

```
document_load                    (auto)
  ├─ resource_fetch (auto)
  ├─ route.change /habits → /chat   (custom, fired from app router events)
  └─ user.interaction              (auto: click on "Send")
       └─ ui.chat.send             (custom; attrs: thread.id, mode)
             └─ http.POST /api/jobs (auto, via fetch instrumentation;
                                      we inject `traceparent` and our
                                      `x-flight-school-trigger-*` headers
                                      from existing builders)
                   └─ http.GET /api/jobs/{id}/stream  (auto, SSE open)
```

We rely on the existing client-trigger headers
(`x-flight-school-trigger-*`) and the existing
`captureTracePropagationHeaders` plumbing on the server — no protocol
changes needed.

### 3.4 Cross-navigation correlation

- The chat hook persists `{ activeJobId, lastAppliedSeq, traceparent }`
  per thread to `sessionStorage`. On remount, it reopens the SSE with
  `Last-Event-ID = lastAppliedSeq` and starts a new client span
  `ui.chat.resume` that **links** the stored `traceparent`. This gives a
  single, navigable trace from the original click through every
  reconnect.
- Page-route changes fire a `route.change` span with `app.from`,
  `app.to`, and `nav.type` (`push|replace|back|reload`). This is the
  hook for answering "did the user navigate away mid-stream?" in trace
  queries.

### 3.5 Things to deliberately *not* do

- Don't add per-keystroke spans. Compose your own minimal interaction
  span set: `ui.chat.send`, `ui.chat.stop`, `ui.thread.select`,
  `ui.repo.attach`.
- Don't ship the OTel SDK to anonymous routes (sign-in page). Gate the
  provider on an authenticated session.

---

## 4. Performance diagnosis plan

Goal: from a single trace, attribute latency to one of {client, network,
queue, worker init, model TTFT, tool latency, persistence, render}.

### 4.1 The five-bucket latency model

For every stream, derive from the trace:

| Bucket            | Definition                                                              |
|-------------------|-------------------------------------------------------------------------|
| Client send       | `ui.chat.send.start` → `http.POST /api/jobs` request body sent          |
| Network (in)      | request body sent → server span starts                                  |
| Enqueue + dispatch| `POST /api/jobs` start → worker `job.execute` span start                |
| Worker init       | `job.execute` start → `copilot.session.create` end                      |
| Model TTFT        | session create end → `ai.stream.first_token` event                      |
| Streaming body    | `first_token` → `stream.completed` (size-normalised: ms/token, ms/byte) |
| Tool wait         | sum of `mcp.tool` child spans inside `ai.stream`                        |
| Persistence       | `stream.completed` → `job.execute` end                                  |
| Network (out) + render | first SSE byte → `ui.chat.first_paint` (client span)               |

Each bucket is either a metric histogram (long term trend) or a derivable
duration from the trace (per-incident). All histograms keyed by
`ai.model`, `mcp.enabled`, `pool.hit`, `tool.count_bucket`.

### 4.2 Dashboards

Three first-class views:

1. **Stream funnel.** Stacked-bar histogram across the buckets in §4.1.
   The single most useful "where did the time go" view.
2. **Tail latency by bucket.** p50/p95/p99 per bucket, per model, per
   day. Spikes in a single bucket point at one subsystem.
3. **Reconnect telemetry.** `sse.replayed_events` rate, distribution of
   `ms_since_disconnect` on `ui.chat.resume`, and reconnect→first-new-token
   delta. Resume must be cheap; if not, we'll see it here.

### 4.3 Investigation runbook

Embed in the dashboard:

- High `queue_wait_ms` → worker pool saturated → check
  `copilot.session.create` queue lengths; verify worker autoscaling.
- High `Worker init` with low `model TTFT` → pool miss; check
  `pool.hit=false` rate.
- High `model TTFT` with healthy worker → upstream model regression;
  cut by `ai.model`.
- High `Tool wait` → drill to `mcp.tool` spans; expect GitHub API to be
  the culprit; cross-reference `flight_school.github.duration_ms`.
- High `Persistence` → disk / `threads.json` contention; expect this to
  go *down* with the event-log change.
- Healthy server but slow user → check `Network (out) + render` and
  `ui.chat.first_paint`; likely client-side React work.

---

## 5. Migration plan

Six phases, each independently shippable behind a flag and each with a
verification gate.

### Phase A — Telemetry quick wins (no behavioural change)

Goal: lift visibility before any refactor.

- Add streaming metrics (§2.3) including `queue_wait_ms` and
  `first_token_ms` (computable today: scratchpad already records
  `firstDeltaMs`).
- Add `ai.stream` child span inside `executeChatResponse` and emit
  `stream.started`, `first_token`, `tool.start`, `tool.complete`,
  `stream.completed` as **events** on that span. No log change yet.
- Promote `mcp.tool` to a real child span instead of summary in
  `activity-logger`.

**Checkpoint:** `queue_wait_ms` histogram populated, traces show
`ai.stream` span with at least three events per chat, no regression in
`npm test`, no change to user-visible behaviour.

### Phase B — Browser OTel + correlation

- Add web SDK in `src/app/providers.tsx`, OTLP proxy route, `ui.chat.send`
  + `route.change` instrumentation.
- Ensure fetch instrumentation does *not* duplicate trace context the
  server already requires.
- Sampler: 10% default, 100% under `?otel=1` query flag.

**Checkpoint:** a single trace exists for click → POST → worker for a
sampled session; route changes appear as spans.

### Phase C — Event log (shadow write)

- Implement `appendEvent`, `readEvents({ fromSeq })`, `projectSnapshot`
  in `src/lib/storage/stream-log.ts`. New on-disk layout
  (`users/{userId}/jobs/{jobId}/events.ndjson` + `snapshot.json`).
- Executor writes **both** scratchpad and event log; reads still come
  from scratchpad.
- Tests: appended events are contiguous, projection equals scratchpad
  state, crash mid-stream leaves a tail-readable log.

**Checkpoint:** for every chat job, `events.ndjson` matches projected
snapshot; existing UX unaffected; metric `stream-log.divergence` is
zero.

### Phase D — SSE endpoint (opt-in)

- Add `GET /api/jobs/{id}/stream`. Implement `Last-Event-ID` resume
  against the event log. Reuse the `ownership` check from
  `/api/jobs/{id}`.
- Add `useJobStream(jobId)` hook. Behind a `NEXT_PUBLIC_CHAT_SSE=1`
  flag, the chat UI subscribes via SSE instead of polling. Polling
  remains the default.
- Hard test reconnection across forced server restart and across client
  navigation.

**Checkpoint:** in opt-in cohort, scratchpad polling rate (the 400 ms
GET) drops to zero; `flight_school.sse.replayed_events` > 0 on
reconnect; no message loss in load test.

### Phase E — Cut over reads; remove scratchpad

- Flip default to SSE; polling becomes the fallback (degraded mode for
  no-EventSource environments).
- Remove the scratchpad write from the executor; remove
  `hydrateThreadsWithScratchpads`. `transformRead` instead reads
  `snapshot.json` per in-flight job. Existing polling clients (if any)
  keep working through the snapshot path.

**Checkpoint:** zero references to `writeScratchpad` outside tests;
disk write rate per stream drops; the
`flight_school.jobs.persist_ms` histogram remains flat or improves.

### Phase F — Long-tail hardening

- Heartbeats every 2 s; SSE proxy buffer-flush; `Retry-After: 0` on
  overflow.
- Janitor sweeps stale `events.ndjson` directories (>1 h since last
  write, no active job) — analogous to the existing scratchpad sweep.
- Add structured failure cause to `stream.failed` event (
  `model_error | tool_error | cancelled | server_restart | timeout`)
  and to the `errorCode` enum on `BackgroundJob`.

**Checkpoint:** reconnect succeeds across a worker rolling restart with
≤1 missed event per stream; janitor metric > 0 after intentional
abandonment test.

### Safety rails (every phase)

- All new code paths default-off; flagged by env vars
  (`STREAM_LOG_ENABLED`, `STREAM_LOG_READ_ENABLED`, `CHAT_SSE_ENABLED`,
  `OTEL_WEB_ENABLED`, `OTEL_WEB_SAMPLE_RATIO`).
- Tenant boundary unchanged: paths stay under
  `users/{userId}/jobs/{jobId}/…`; SSE endpoint reuses ownership check.
- Phase C must include a divergence metric (event-log vs. scratchpad
  state at consolidation time). Promote to fail-closed before Phase E.
- Each phase ships behind a feature flag with a kill switch and a
  documented rollback (revert flag, no data migration needed because
  scratchpad coexists through Phase D).

---

## 6. Repo file touchpoints

Authoritative list — files to add, edit, or remove per phase. No code
changes are part of this plan; this is the surface map.

### Phase A — telemetry only

- **Edit** `src/lib/observability/telemetry.ts` — add streaming + jobs
  histograms / counters; export `withChildSpan` helper if needed.
- **Edit** `src/lib/copilot/streaming.ts` — open an `ai.stream` child
  span inside `generateStream`; emit events on first delta, tool start,
  tool complete, done, error; record streaming metrics on close.
- **Edit** `src/worker/jobs/executors/chat.ts` — wrap executor body in
  `job.execute` root span (worker-side trace root), add
  `jobs.queue_wait_ms` derivation from `causality.capturedAt`.
- **Edit** `src/lib/copilot/mcp.ts` — wrap tool invocations in a
  `mcp.tool` child span; record `tool.duration_ms`.
- **Tests** `src/lib/observability/telemetry.test.ts` (new),
  `src/lib/copilot/streaming.test.ts` extensions.

### Phase B — browser OTel

- **Add** `src/lib/observability/web/index.ts` — web SDK bootstrap.
- **Add** `src/app/api/internal/otlp/v1/traces/route.ts` — proxy to
  collector, requires authenticated user, drops payload otherwise.
- **Edit** `src/app/providers.tsx` — mount web telemetry provider only
  when authenticated.
- **Add** `src/hooks/use-interaction-span.ts` — wraps
  `ui.chat.send`/`ui.chat.stop` spans.
- **Edit** `src/hooks/use-learning-chat.ts` — start `ui.chat.send`
  span; persist `traceparent` to `sessionStorage`.

### Phase C — event log shadow write

- **Add** `src/lib/storage/stream-log.ts` — `appendEvent`,
  `readEvents`, `projectSnapshot`, `sweepStaleStreamLogs`.
- **Add** `src/lib/storage/stream-log.test.ts`.
- **Edit** `src/worker/jobs/executors/chat.ts` — shadow-write events
  alongside `writeScratchpad`; ensure `seq` monotonic; project snapshot
  on debounce.
- **Edit** `src/lib/storage/retention.ts` — include `jobs/{jobId}/`
  directories in retention sweep.

### Phase D — SSE endpoint

- **Add** `src/app/api/jobs/[id]/stream/route.ts` — SSE handler;
  ownership check (mirror `[id]/route.ts`); honour `Last-Event-ID`.
- **Add** `src/hooks/use-job-stream.ts` — `EventSource` lifecycle,
  reconnect on remount, `lastAppliedSeq` cursor, links to
  `traceparent` for resume span.
- **Edit** `src/hooks/use-learning-chat-stream.ts` — when the SSE flag
  is on, replace the 400 ms `setInterval(refreshThreads)` with the new
  hook; keep polling as fallback.

### Phase E — cutover

- **Edit** `src/app/api/threads/storage/route.ts` — `transformRead`
  reads `snapshot.json` instead of scratchpad; identical output shape.
- **Remove** `src/lib/storage/scratchpad.ts` (after grace window).
- **Remove** `writeScratchpad`/`hydrateThreadsWithScratchpads`
  references from executors and tests.
- **Edit** `src/instrumentation.ts` — sweep includes orphan
  `events.ndjson` directories; emit `stream.failed`
  events for stale jobs on restart.

### Phase F — hardening

- **Edit** SSE route — heartbeats, ring-buffer overflow handling.
- **Edit** `src/lib/jobs/storage.ts` — extend `JobErrorCode` union
  with `model_error | tool_error | timeout | server_restart`.
- **Edit** retention sweep job for `events.ndjson` directories.

### Cross-cutting

- `docs/architecture-multitenant.md` — add a "streaming" subsection
  pointing to this plan.
- `docs/superpowers/specs/` — companion spec for SSE wire contract.

---

## 7. Open questions / explicit non-decisions

- **Storage backend.** Files are kept; revisit only after Phase E
  if disk IO is a bottleneck (the event-log shape makes a SQLite or
  Redis-stream swap a localised change).
- **Multi-region.** Out of scope; the model is per-region and per-user
  affinity already.
- **Token usage accounting.** Add `ai.stream.tokens_in` /
  `tokens_out` attrs only if the SDK exposes them — confirmed as a
  Phase A stretch task.

---

## 8. Success criteria

The plan is done when:

1. A single trace links a click in `/chat` to the SSE delta that
   delivered its first model token, across a forced page reload.
2. The five-bucket latency funnel exists in the dashboard and can answer
   "where did the 8 seconds go" for any user-reported slow stream within
   2 minutes.
3. A worker rolling restart preserves in-flight streams from the user's
   perspective (resume within 1 s, no duplicated content, no lost
   content).
4. `threads.json` is rewritten only on terminal stream state.
5. p95 `queue_wait_ms` and p95 `ai.stream.first_token_ms` are reported
   to the team weekly; alerts fire on 2x baseline regressions.
