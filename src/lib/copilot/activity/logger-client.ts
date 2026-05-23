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
import { getCopilotWorkerConfig } from '@/lib/copilot/execution/config';
import {
  captureTracePropagationHeaders,
  mergeTracePropagationHeaders,
} from '@/lib/observability/context-propagation';

import type {
  AIActivityInput,
  AIActivityOutput,
  AIActivityStatus,
  AIActivityType,
} from './types';

const log = logger.withTag('ActivityLoggerClient');

export type CompleteOperation = (
  output?: AIActivityOutput,
  error?: string,
  serverMetrics?: {
    firstTokenMs?: number | null;
    totalMs?: number;
  },
) => void;

function requireConfig() {
  const config = getCopilotWorkerConfig();
  if (!config) {
    throw new Error('Copilot worker is required for activity logging');
  }
  return config;
}

function buildHeaders(userId: string) {
  const config = requireConfig();
  const trace = captureTracePropagationHeaders();
  return {
    config,
    headers: mergeTracePropagationHeaders(
      {
        authorization: `Bearer ${config.secret}`,
        'content-type': 'application/json',
        'x-user-id': userId,
      },
      trace,
    ),
  };
}

interface PostEventBody {
  type: AIActivityType;
  operationName: string;
  input?: AIActivityInput;
  output?: AIActivityOutput;
  status: AIActivityStatus;
  error?: string;
}

async function postEvent(userId: string, body: PostEventBody): Promise<string | null> {
  try {
    const { config, headers } = buildHeaders(userId);
    const response = await fetch(`${config.baseUrl}/api/internal/ai-activity/event`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      log.warn('Activity POST failed', { status: response.status });
      return null;
    }
    const data = (await response.json()) as { id?: string };
    return typeof data.id === 'string' ? data.id : null;
  } catch (err) {
    log.warn('Activity POST threw', { err });
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
    const { config, headers } = buildHeaders(userId);
    const response = await fetch(
      `${config.baseUrl}/api/internal/ai-activity/event/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      log.warn('Activity PATCH failed', { status: response.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('Activity PATCH threw', { err });
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
