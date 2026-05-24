import type { DispatchJobExecutionRequest } from '@/lib/jobs/dispatch';
import { jobStorage } from '@/lib/jobs';
import { logger } from '@/lib/logger';
import {
  buildSpanLinksFromTraceContext,
  type TracePropagationHeaders,
} from '@/lib/observability/context-propagation';
import {
  toClientTriggerSpanAttributes,
  type ClientTriggerMetadata,
} from '@/lib/observability/trigger-metadata';
import { recordJobQueueWait } from '@/lib/observability/telemetry';
import {
  INSTRUMENTATION_SCOPE_SERVER,
  INSTRUMENTATION_SCOPE_VERSION,
} from '@/lib/observability/semconv';
import { context, trace } from '@opentelemetry/api';
import { executeWorkerJob } from '@/worker/jobs/executor-dispatcher';

const log = logger.withTag('InternalJobExecute');
const tracer = trace.getTracer(INSTRUMENTATION_SCOPE_SERVER, INSTRUMENTATION_SCOPE_VERSION);

export function scheduleWorkerJobExecution(
  request: DispatchJobExecutionRequest,
  causality?: TracePropagationHeaders & { trigger?: ClientTriggerMetadata; capturedAt?: string },
): void {
  setImmediate(() => {
    const links = buildSpanLinksFromTraceContext(causality ?? {});
    const triggerAttributes = causality?.trigger
      ? toClientTriggerSpanAttributes(causality.trigger)
      : {};
    const queueWaitMs = getQueueWaitMs(causality?.capturedAt);
    if (queueWaitMs !== undefined) {
      recordJobQueueWait(queueWaitMs, request.type);
    }
    const span = tracer.startSpan('worker.job.execute', {
      attributes: {
        'job.id': request.jobId,
        'job.type': request.type,
        ...(queueWaitMs !== undefined ? { 'job.queue_wait_ms': queueWaitMs } : {}),
        ...triggerAttributes,
      },
      links,
    });

    const activeContext = trace.setSpan(context.active(), span);
    void context.with(activeContext, async () => {
      try {
        await executeWorkerJob(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown worker execution failure';
        log.error(`[Job ${request.jobId}] Worker execution failed`, { message });
        try {
          await jobStorage.markFailed(request.jobId, message, 'unknown');
        } catch (markErr) {
          log.error(`[Job ${request.jobId}] Failed to mark job failed after worker error`, markErr);
        }
      } finally {
        span.end();
      }
    });
  });
}

function getQueueWaitMs(capturedAt: string | undefined): number | undefined {
  if (!capturedAt) return undefined;
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) return undefined;
  const durationMs = Date.now() - capturedAtMs;
  if (durationMs < 0) return undefined;
  return durationMs;
}
