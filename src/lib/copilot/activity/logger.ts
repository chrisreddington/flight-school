/**
 * Activity logger surface used by worker-internal callers (logged
 * sessions, streaming sessions, authoring sessions).
 *
 * Wraps the synchronous worker singleton in a thin adapter that awaits
 * `ensureHydrated(userId)` before every operation. Worker-side callers
 * import {@link activityLogger}; the public web tier never imports
 * this module — it talks to the worker over HTTP via the routes under
 * `/api/internal/ai-activity/*` (handled inside the worker process).
 */
import { activityLoggerWorker } from './logger-worker';
import type {
  AIActivityInput,
  AIActivityOutput,
  AIActivityStatus,
  AIActivityType,
} from './types';

/**
 * Closure returned by {@link ActivityLogger.startOperation}. Call
 * exactly once when the operation completes (success or error). The
 * `serverMetrics` parameter lets callers attach server-side timing at
 * completion time instead of mutating retained event state.
 */
export type CompleteOperation = (
  output?: AIActivityOutput,
  error?: string,
  serverMetrics?: {
    firstTokenMs?: number | null;
    totalMs?: number;
  },
) => void;

/**
 * Shared shape between the worker singleton and the HTTP client
 * wrapper. Both surfaces converge to:
 *  - `startOperation` returning a Promise — awaiting it guarantees
 *    the event id is known before the caller begins streaming.
 *  - `logEvent` as a fire-and-forget surface.
 *  - `updateWithClientMetrics` returning a Promise<boolean> matching
 *    the existing 404 semantics in `/api/ai-activity/metrics`.
 *  - `clear` returning a Promise so the worker impl can flush its
 *    durable store; the client impl is a no-op.
 */
export interface ActivityLogger {
  startOperation(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
  ): Promise<{ eventId: string | null; complete: CompleteOperation }>;
  logEvent(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
    output?: AIActivityOutput,
    status?: AIActivityStatus,
  ): void;
  updateWithClientMetrics(
    userId: string,
    eventId: string,
    clientMetrics: { firstTokenMs?: number; totalMs?: number },
  ): Promise<boolean>;
  clear(userId: string): Promise<void>;
}

/**
 * Wrap the synchronous worker impl in an async adapter so callers can
 * `await` `ensureHydrated` for the user before forwarding to the
 * worker singleton; without this, an in-process caller (streaming,
 * logged session, authoring) racing the durable-store load could
 * append events to the bus before hydration completes, and hydration
 * would then duplicate them. We keep the inner worker methods
 * synchronous because the HTTP routes already await hydration before
 * calling them.
 */
const workerAdapter: ActivityLogger = {
  async startOperation(userId, type, operation, input) {
    await activityLoggerWorker.ensureHydrated(userId);
    const { eventId, complete } = activityLoggerWorker.startOperation(
      userId,
      type,
      operation,
      input,
    );
    return { eventId, complete };
  },
  logEvent(userId, type, operation, input, output, status) {
    // Fire-and-forget — defer the bus append until hydration completes
    // so durable-store events don't reappear as duplicates.
    void (async () => {
      await activityLoggerWorker.ensureHydrated(userId);
      activityLoggerWorker.logEvent(userId, type, operation, input, output, status);
    })();
  },
  async updateWithClientMetrics(userId, eventId, clientMetrics) {
    await activityLoggerWorker.ensureHydrated(userId);
    return activityLoggerWorker.updateWithClientMetrics(userId, eventId, clientMetrics);
  },
  async clear(userId) {
    await activityLoggerWorker.clear(userId);
  },
};

export const activityLogger: ActivityLogger = workerAdapter;
