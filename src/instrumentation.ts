/**
 * Next.js Instrumentation
 *
 * This file runs on server startup and shutdown.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { registerOTel } from '@vercel/otel';

import { logger } from '@/lib/logger';

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
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
        }),
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

    try {
      const { jobStorage } = await import('@/lib/jobs');
      const jobs = await jobStorage.getAll();
      const staleJobs = jobs.filter((job) => job.status === 'pending' || job.status === 'running');

      await Promise.all(
        staleJobs.map((job) => jobStorage.markFailed(job.id, 'Server process restarted'))
      );

      if (staleJobs.length > 0) {
        log.info(`Marked ${staleJobs.length} stale jobs as failed on startup`);
      }
    } catch (err) {
      log.warn('Failed to mark stale jobs on startup', { err });
    }
  }
}
