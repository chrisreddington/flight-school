/**
 * Web-side activity logger.
 *
 * Thin HTTP client wrapper that proxies every call to the worker's
 * `/api/internal/ai-activity/*` endpoints. Selected at module-load
 * time by `logger.ts` when `COPILOT_WORKER_MODE !== '1'`.
 *
 * Multi-tenant invariant: every call passes the server-resolved
 * `userId` (from `requireUserContext`) via the `x-user-id` header.
 * The worker is the only place that owns the event store.
 */
import { logger } from '@/lib/logger';
import { workerFetchJson } from '@/lib/copilot/execution/worker-fetch';
import { captureTracePropagationHeaders } from '@/lib/observability/context-propagation';

import type {
  AIActivityInput,
  AIActivityOutput,
  AIActivityStatus,
  AIActivityType,
} from './types';

const log = logger.withTag('ActivityLoggerClient');

type CompleteOperation = (
  output?: AIActivityOutput,
  error?: string,
  serverMetrics?: {
    firstTokenMs?: number | null;
    totalMs?: number;
  },
) => void;

interface PostEventBody {
  type: AIActivityType;
  operationName: string;
  input?: AIActivityInput;
  output?: AIActivityOutput;
  status: AIActivityStatus;
  error?: string;
}

// Activity logging must never block AI work — swallow transport errors and
// return null so the caller can fall back to a local-only completion path.
async function postEvent(userId: string, body: PostEventBody): Promise<string | null> {
  try {
    const result = await workerFetchJson<{ id?: string }>(
      '/api/internal/ai-activity/event',
      { method: 'POST', headers: { 'x-user-id': userId }, body: JSON.stringify(body) },
      { errorContext: 'activity post', traceContext: captureTracePropagationHeaders() },
    );
    return typeof result?.id === 'string' ? result.id : null;
  } catch (err) {
    log.warn('Activity POST failed', { err });
    return null;
  }
}

interface PatchEventBody {
  status?: AIActivityStatus;
  output?: AIActivityOutput;
  error?: string;
  latencyMs?: number;
  clientMetrics?: { firstTokenMs?: number; totalMs?: number };
  serverMetrics?: { firstTokenMs?: number | null; totalMs?: number };
}

async function patchEvent(
  userId: string,
  eventId: string,
  body: PatchEventBody,
): Promise<boolean> {
  try {
    const result = await workerFetchJson<unknown>(
      `/api/internal/ai-activity/event/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', headers: { 'x-user-id': userId }, body: JSON.stringify(body) },
      {
        errorContext: 'activity patch',
        traceContext: captureTracePropagationHeaders(),
        allowNotFound: true,
      },
    );
    return result !== null;
  } catch (err) {
    log.warn('Activity PATCH failed', { err });
    return false;
  }
}

class ActivityLoggerClient {
  /**
   * Start an SDK operation. AWAITS the POST round-trip so the eventId
   * is known before the caller begins streaming.
   */
  async startOperation(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
  ): Promise<{ eventId: string | null; complete: CompleteOperation }> {
    const startTime = performance.now();
    const eventId = await postEvent(userId, {
      type,
      operationName: operation,
      input,
      status: 'pending',
    });

    if (!eventId) {
      // POST failed — return a no-op closure that logs locally so AI
      // work isn't blocked by activity-logging outages.
      const complete: CompleteOperation = (_output, error) => {
        if (error) log.warn('AI operation errored (activity offline)', { error });
      };
      return { eventId: null, complete };
    }

    const complete: CompleteOperation = (output, error, serverMetrics) => {
      const clientTotalMs = input?.clientMetrics?.totalMs;
      const latencyMs = clientTotalMs ?? Math.round(performance.now() - startTime);
      // Fire-and-forget; the worker is the source of truth for retries.
      void patchEvent(userId, eventId, {
        status: error ? 'error' : 'success',
        output,
        error,
        latencyMs,
        serverMetrics,
      });
    };

    return { eventId, complete };
  }

  /** Fire-and-forget single event. */
  logEvent(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
    output?: AIActivityOutput,
    status: AIActivityStatus = 'success',
  ): void {
    void postEvent(userId, { type, operationName: operation, input, output, status });
  }

  async updateWithClientMetrics(
    userId: string,
    eventId: string,
    clientMetrics: { firstTokenMs?: number; totalMs?: number },
  ): Promise<boolean> {
    return patchEvent(userId, eventId, { clientMetrics });
  }

  /**
   * Web-side `clear` is a no-op. The destructive DELETE is handled by
   * the worker via `/api/user/data`'s parallel worker-DELETE call.
   */
  async clear(): Promise<void> {
    // intentional no-op
  }
}

export const activityLoggerClient = new ActivityLoggerClient();
