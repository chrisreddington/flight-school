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
import {
  AggregationType,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
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
        'deployment.environment.name':
          process.env.NODE_ENV === 'production' ? 'production' : 'development',
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
      spanProcessors: [
        new BatchSpanProcessor(
          new BubbleFilteringSpanExporter(new OTLPTraceExporter()),
        ),
      ],
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
      logRecordProcessors: [
        new BatchLogRecordProcessor(new OTLPLogExporter()),
      ],
    });

    log.info('Server starting...');
    const shouldWarm = process.env.COPILOT_WARMUP_ON_START !== 'false';
    if (shouldWarm) {
      const { warmCopilotClient, shutdownAllPools } = await import('@/lib/copilot/sessions');
      try {
        await warmCopilotClient();
        log.info('Copilot client warmed');
      } catch (err) {
        // Non-fatal: app works without pre-warmed client; first request will init it
        log.warn('Copilot client warmup failed (will init on first request)', { err });
      }
      
      // Register shutdown handler (once, for SIGINT/SIGTERM)
      const shutdown = async (signal: string) => {
        log.info(`Received ${signal}, shutting down...`);
        await shutdownAllPools();
        process.exit(0);
      };
      
      process.once('SIGINT', () => shutdown('SIGINT'));
      process.once('SIGTERM', () => shutdown('SIGTERM'));
    }

    // Phase 2B.2: restart-sweep only runs in the WORKER process. The
    // web tier no longer owns jobStorage. Without this gate every
    // running web replica would compete to mark jobs failed on boot.
    if (process.env.COPILOT_WORKER_MODE === '1') {
      try {
        const { jobStorage } = await import('@/lib/jobs');
        const jobs = await jobStorage.getAll();
        const staleJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'running');

        await Promise.all(
          staleJobs.map((job) => jobStorage.markFailed(job.id, 'Server process restarted'))
        );

        // Clean up any chat threads that were mid-stream when the worker
        // restarted. Without this, threads.json still has `isStreaming: true`
        // and the UI would display a stuck cursor indefinitely until the
        // user manually navigates away.
        const staleChatJobs = staleJobs.filter((job) => job.type === 'chat-response');
        if (staleChatJobs.length > 0) {
          const [{ getThreadById, updateThread }, { stripLegacyCursorFromThread }] = await Promise.all([
            import('@/lib/jobs/storage/threads-storage'),
            import('@/lib/threads/legacy-cursor'),
          ]);
          await Promise.all(
            staleChatJobs.map(async (job) => {
              const input = (job.input ?? {}) as { threadId?: string; assistantMessageId?: string };
              if (!input.threadId || !job.userId) return;
              try {
                const thread = await getThreadById(job.userId, input.threadId);
                if (!thread) return;
                // Strip any residual `▊` left by pre-Phase-5 workers,
                // and clear `isStreaming` so the UI does not render a
                // stuck cursor on restart.
                const stripped = stripLegacyCursorFromThread(thread);
                const needsUpdate =
                  stripped !== thread || thread.isStreaming === true;
                if (needsUpdate) {
                  await updateThread(job.userId, {
                    ...stripped,
                    isStreaming: false,
                    updatedAt: new Date().toISOString(),
                  });
                }
              } catch (err) {
                log.warn('Failed to clear stale chat thread state', {
                  err,
                  jobId: job.id,
                  threadId: input.threadId,
                });
              }
            })
          );
        }

        if (staleJobs.length > 0) {
          log.info(`Marked ${staleJobs.length} stale jobs as failed on startup (${staleChatJobs.length} chat threads cleared)`);
        }
      } catch (err) {
        log.warn('Failed to mark stale jobs on startup', { err });
      }
    }
  }
}
