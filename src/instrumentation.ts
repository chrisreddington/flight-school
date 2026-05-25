/**
 * Next.js Instrumentation
 *
 * This file runs on server startup and shutdown.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { AggregationType, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { registerOTel } from '@vercel/otel';

import { logger } from '@/lib/logger';
import { BubbleFilteringSpanExporter } from '@/lib/observability/bubble-filter-exporter';
import { createTelemetryHygieneSampler } from '@/lib/observability/proxy-sampler';
import {
  GEN_AI_DURATION_BUCKETS,
  GEN_AI_TOKEN_USAGE_BUCKETS,
  INSTRUMENTATION_SCOPE_VERSION,
  METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
  METRIC_GEN_AI_CLIENT_TIME_TO_FIRST_CHUNK,
  METRIC_GEN_AI_CLIENT_TOKEN_USAGE,
} from '@/lib/observability/semconv';

const log = logger.withTag('Instrumentation');

export async function register(): Promise<void> {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // `@vercel/otel` installs a tracer provider by default but only wires
    // a meter provider / log record provider when explicitly given
    // `metricReaders` / `logRecordProcessors`. Without these, every
    // `metrics.getMeter(...).createHistogram(...)` and every OTel-bridged
    // log call is silently dropped. See `.github/skills/opentelemetry/SKILL.md`.
    //
    // Both exporters pick up `OTEL_EXPORTER_OTLP_ENDPOINT` and
    // `OTEL_EXPORTER_OTLP_HEADERS` from the env Aspire injects, so no
    // explicit endpoint config is needed here.
    registerOTel({
      serviceName: process.env.OTEL_SERVICE_NAME ?? 'flight-school',
      attributes: {
        'service.version': INSTRUMENTATION_SCOPE_VERSION,
        // Note: the spec renamed `deployment.environment` to `deployment.environment.name`.
        'deployment.environment.name': process.env.NODE_ENV === 'production' ? 'production' : 'development',
      },
      // Drop high-noise spans before they reach the exporter:
      //   - **Sampler (head-time):** server-side spans for the
      //     browser→server OTel proxy route (self-tracing feedback loop
      //     on every BSP flush) and Next.js framework stub INTERNAL
      //     spans. See `src/lib/observability/proxy-sampler.ts`.
      //   - **Filtering exporter (export-time):** Next.js "bubble"
      //     wrapper SERVER spans — these cannot be safely dropped at
      //     the sampler because the discriminating attribute
      //     (`next.bubble`) is set after `startSpan()` (in
      //     `closeSpanWithError`). See
      //     `src/lib/observability/bubble-filter-exporter.ts`.
      //
      // ## Why `spanProcessors` rather than `traceExporter`
      //
      // `@vercel/otel`'s `traceExporter` option is **additive** when
      // `spanProcessors` is unset or `'auto'`: an auto-configured OTLP
      // `BatchSpanProcessor` runs in parallel whenever
      // `OTEL_EXPORTER_OTLP_ENDPOINT` is present (Aspire injects this).
      // Passing our wrapper via `traceExporter` would therefore leave a
      // second, unfiltered exporter alive — bubbles would still leak and
      // keepers would be double-exported.
      //
      // Setting `spanProcessors` to a non-`'auto'` array makes
      // `@vercel/otel` skip its auto branch entirely (see
      // `@vercel/otel/dist/node/index.js` `r2()`), so our wrapped
      // exporter is the **only** trace export path. The composite
      // processor that injects `operation.name` still wraps every
      // user-supplied processor, so `onEnd` ordering is preserved.
      traceSampler: createTelemetryHygieneSampler(),
      spanProcessors: [new BatchSpanProcessor(new BubbleFilteringSpanExporter(new OTLPTraceExporter()))],
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
        }),
      ],
      // GenAI semconv recommends explicit bucket boundaries for the
      // duration and token-usage histograms; the SDK default
      // (millisecond-scale buckets) is unsuitable for our second-scale
      // values and would crush most data into a single bucket.
      views: [
        {
          instrumentName: METRIC_GEN_AI_CLIENT_OPERATION_DURATION,
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: GEN_AI_DURATION_BUCKETS, recordMinMax: true },
          },
        },
        {
          instrumentName: METRIC_GEN_AI_CLIENT_TIME_TO_FIRST_CHUNK,
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: GEN_AI_DURATION_BUCKETS, recordMinMax: true },
          },
        },
        {
          instrumentName: METRIC_GEN_AI_CLIENT_TOKEN_USAGE,
          aggregation: {
            type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
            options: { boundaries: GEN_AI_TOKEN_USAGE_BUCKETS, recordMinMax: true },
          },
        },
      ],
      logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    });

    log.info('Server starting...');
  }
}
