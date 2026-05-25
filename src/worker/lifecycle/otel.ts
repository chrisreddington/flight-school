/**
 * Worker-side OpenTelemetry bootstrap.
 *
 * Uses `@opentelemetry/sdk-node` (NOT `@vercel/otel`, which is web-only —
 * see `.github/skills/opentelemetry/SKILL.md`). The instrumentations,
 * exporters, samplers, and views mirror the web-side config in
 * `src/instrumentation.ts` so traces / metrics / logs are produced
 * identically — only the framework adapter differs.
 *
 * `startWorkerOtel()` MUST be awaited from inside `bootstrap.ts`'s
 * `main()` before the Hono handler graph is dynamically imported.
 * Calling it after `@opentelemetry/api`, `undici`, or `http` have been
 * loaded by the handler graph would install instrumentation patches
 * after the patched targets were already cached, producing missing or
 * partial spans.
 */

import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import {
  AggregationType,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';

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

const log = logger.withTag('WorkerOtel');

let sdk: NodeSDK | null = null;

export async function startWorkerOtel(): Promise<void> {
  if (sdk) return;

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'flight-school-worker';

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': serviceName,
      'service.version': INSTRUMENTATION_SCOPE_VERSION,
      'deployment.environment.name':
        process.env.NODE_ENV === 'production' ? 'production' : 'development',
    }),
    sampler: createTelemetryHygieneSampler(),
    spanProcessors: [
      new BatchSpanProcessor(
        new BubbleFilteringSpanExporter(new OTLPTraceExporter()),
      ),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
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
    instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
  });

  sdk.start();
  log.info('Worker OTel started', { serviceName });
}

export async function shutdownWorkerOtel(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    log.warn('OTel shutdown failed', { err });
  }
  sdk = null;
}
