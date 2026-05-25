/**
 * Filtering SpanExporter that drops known framework-emitted noise spans
 * before they reach the OTLP exporter.
 *
 * Currently drops:
 *   1. Next.js "bubble" wrapper SERVER spans (`isNextjsBubbleReadableSpan`).
 *   2. Next.js dev-only npm registry update-check fetches
 *      (`isFrameworkUpdateCheckSpan`).
 *
 * ## Why an exporter wrapper rather than a sampler
 *
 * Next.js's built-in instrumentation emits TWO sibling SERVER spans for
 * every API request:
 *
 *   - **Bubble**: bare-method name (`"GET"`, `"POST"`), tagged with
 *     `next.bubble = true` (set late, via `setAttribute` in
 *     `closeSpanWithError`). No `http.route`, no `next.route`. This is the
 *     wrapper Next.js uses to swallow errors that escape the route handler.
 *   - **Keeper**: the real route span. Initially started with the same
 *     bare-method name and identical start attributes, then renamed via
 *     `span.updateName()` to `"METHOD /api/route"` and decorated with
 *     `http.route`, `next.route`, and (by `@vercel/otel`'s composite
 *     processor on `onEnd`) `operation.name = "web.request"`.
 *
 * Bubble filtering MUST run at the exporter, not the sampler. At
 * `startSpan()` time the bubble and the keeper are structurally
 * identical — none of the discriminating attributes (`next.bubble`,
 * `http.route`, `next.route`, `operation.name`) exist yet. Any
 * sampler-level discriminator either drops the keeper too (which
 * kills the entire downstream tree via `ParentBasedSampler`
 * propagation) or is a silent no-op.
 *
 * By the time spans reach `SpanExporter.export()`, every span has
 * ended, `closeSpanWithError` has set `next.bubble` on the bubble
 * (and only on the bubble), and all attributes are fully visible. A
 * mistaken filter here would drop only the misidentified span —
 * never its children — eliminating the tree-kill failure mode.
 *
 * ## Discriminator
 *
 * Sole signal: `next.bubble === true` (boolean; defensively also `'true'`
 * string in case a serialization path stringifies). Set by Next.js's
 * `closeSpanWithError` ONLY on the bubble wrapper span — never on the
 * keeper, even when the keeper errors.
 *
 * **Why not also `operation.name === 'next_js.BaseServer.handleRequest'`
 * as a fallback?** Tempting but unsafe: a keeper that errors BEFORE the
 * route is resolved (e.g. middleware rejection) would not have
 * `http.route` set, and `@vercel/otel`'s `CompositeSpanProcessor.onEnd`
 * would assign it `operation.name = "next_js.BaseServer.handleRequest"`.
 * Such a failed keeper does NOT have `next.bubble` (per Next.js source,
 * `closeSpanWithError` only sets `next.bubble` for the bubble wrapper),
 * so it would be wrongly dropped. Sticking to `next.bubble` alone is the
 * safe choice.
 *
 * The discriminator is intersected with `SpanKind.SERVER` so we never
 * accidentally drop CLIENT, INTERNAL, CONSUMER, or PRODUCER spans.
 */

import { SpanKind } from '@opentelemetry/api';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';

/**
 * Returns `true` if the given fully-ended span is a Next.js bubble
 * wrapper SERVER span that should be dropped before export. Exposed for
 * unit testing.
 */
export function isNextjsBubbleReadableSpan(span: ReadableSpan): boolean {
  if (span.kind !== SpanKind.SERVER) {
    return false;
  }
  const bubble = span.attributes['next.bubble'];
  return bubble === true || bubble === 'true';
}

/**
 * Returns `true` if the span is a Next.js dev-only outbound fetch that
 * is pure noise in traces. Today this matches Next.js's update-notifier
 * fetch to `https://registry.npmjs.org/-/package/next/dist-tags`, which
 * fires once per dev boot and is not configurable via env. Production
 * builds do not emit it, so this check is safe to run unconditionally.
 *
 * Exposed for unit testing.
 */
export function isFrameworkUpdateCheckSpan(span: ReadableSpan): boolean {
  if (span.kind !== SpanKind.CLIENT) {
    return false;
  }
  const url = span.attributes['http.url'];
  if (typeof url !== 'string') {
    return false;
  }
  return url.startsWith('https://registry.npmjs.org/-/package/next/dist-tags');
}

function isNoiseSpan(span: ReadableSpan): boolean {
  return isNextjsBubbleReadableSpan(span) || isFrameworkUpdateCheckSpan(span);
}

/**
 * Wraps an underlying `SpanExporter`, filtering out Next.js bubble
 * wrapper SERVER spans before delegating to the underlying exporter.
 *
 * **Wire via `spanProcessors`, not `traceExporter`.** `@vercel/otel`'s
 * `traceExporter` option is additive (an auto-configured OTLP exporter
 * still runs in parallel when `OTEL_EXPORTER_OTLP_ENDPOINT` is set),
 * which would leave a second unfiltered export path alive and defeat
 * the whole point. Wire as:
 *
 * ```ts
 * spanProcessors: [
 *   new BatchSpanProcessor(
 *     new BubbleFilteringSpanExporter(new OTLPTraceExporter()),
 *   ),
 * ],
 * ```
 *
 * If every span in a batch is a bubble, the underlying exporter is
 * short-circuited via a `SUCCESS` callback so the batch processor's
 * flush bookkeeping stays correct.
 */
export class BubbleFilteringSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    const keep = spans.filter((span) => !isNoiseSpan(span));
    if (keep.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }
    this.delegate.export(keep, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}
