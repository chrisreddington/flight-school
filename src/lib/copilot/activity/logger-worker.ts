/**
 * Worker-side activity logger.
 *
 * The authoritative in-process owner of {@link AIActivityEvent} state.
 * Used directly by:
 *  - the in-process worker code paths that run AI work
 *    (`src/lib/copilot/streaming.ts`, `logged-session.ts`, the
 *    challenge authoring session)
 *  - the internal HTTP routes under `/api/internal/ai-activity/` that
 *    the web tier proxies to.
 *
 * Persists to `activity-store.ts` for restart durability and broadcasts
 * each append/update through the per-user `activityBus`.
 */
import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';

import { activityBus } from './activity-bus';
import {
  appendActivityEvent,
  clearActivityEvents,
  loadActivityEvents,
} from './activity-store';
import type {
  AIActivityEvent,
  AIActivityInput,
  AIActivityOutput,
  AIActivityStats,
  AIActivityStatus,
  AIActivityType,
} from './types';

const log = logger.withTag('ActivityLoggerWorker');

/**
 * Closure returned by {@link AIActivityLoggerWorker.startOperation}.
 * Call exactly once when the operation completes (success or error).
 *
 * `serverMetrics` lets callers attach server-side timing (e.g. first
 * delta latency) at the moment they call `complete`; this replaces the
 * old pattern of mutating `event.input.serverMetrics` in place.
 */
export type CompleteOperation = (
  output?: AIActivityOutput,
  error?: string,
  serverMetrics?: {
    firstTokenMs?: number | null;
    totalMs?: number;
  },
) => void;

class AIActivityLoggerWorker {
  private static instance: AIActivityLoggerWorker;
  private hydrationByUser = new Map<string, Promise<void>>();

  private constructor() {
    // Singleton
  }

  static getInstance(): AIActivityLoggerWorker {
    if (!AIActivityLoggerWorker.instance) {
      AIActivityLoggerWorker.instance = new AIActivityLoggerWorker();
    }
    return AIActivityLoggerWorker.instance;
  }

  /**
   * Lazily seed the per-user bus from the durable store the first
   * time we observe `userId`. Subsequent calls are no-ops. The bus is
   * the single source of truth for retained events; we do not maintain
   * a separate id→event map so hydration cannot diverge from lookups
   * used by {@link applyUpdate}.
   */
  async ensureHydrated(userId: string): Promise<void> {
    let pending = this.hydrationByUser.get(userId);
    if (pending) return pending;
    pending = (async () => {
      try {
        const stored = await loadActivityEvents(userId);
        activityBus.hydrate(userId, stored);
      } catch (err) {
        log.warn('Failed to hydrate activity store', { err, userId });
      }
    })();
    this.hydrationByUser.set(userId, pending);
    await pending;
  }

  private generateId(): string {
    return `${nowMs()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private persist(event: AIActivityEvent): void {
    void appendActivityEvent(event).catch((err) => {
      log.warn('Failed to persist activity event', { err, eventId: event.id });
    });
  }

  /**
   * Build a NEW event with status `pending`, broadcast it via the bus,
   * and persist it. Returns the event so callers can grab the assigned id.
   */
  createPending(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
  ): AIActivityEvent {
    const event: AIActivityEvent = {
      id: this.generateId(),
      userId,
      timestamp: new Date(),
      type,
      operation,
      input,
      latencyMs: 0,
      status: 'pending',
    };
    activityBus.append(userId, event);
    this.persist(event);
    return event;
  }

  /**
   * Apply a partial update to a retained event. Returns the updated
   * event (or `null` when the id is unknown / not owned by `userId`).
   *
   * Uses immutable copy-on-write rather than in-place mutation so that
   * a persist task whose serialization runs AFTER another update path
   * has run still captures a stable snapshot of the version it was
   * paired with. Without this, a long persist queue could observe a
   * later mutation and either over- or under-write disk state.
   * Broadcasts the updated event to bus subscribers and re-persists.
   */
  applyUpdate(
    userId: string,
    eventId: string,
    update: {
      status?: AIActivityStatus;
      output?: AIActivityOutput;
      error?: string;
      latencyMs?: number;
      clientMetrics?: { firstTokenMs?: number; totalMs?: number };
      serverMetrics?: { firstTokenMs?: number | null; totalMs?: number };
    },
  ): AIActivityEvent | null {
    const existing = activityBus.getById(userId, eventId);
    if (!existing) return null;

    // Shallow-clone the event so we can apply changes without mutating
    // the bus's retained instance until we call `bus.update` to swap it.
    // Also clone `input` since we may mutate its nested metrics objects.
    const updated: AIActivityEvent = {
      ...existing,
      input: existing.input ? { ...existing.input } : undefined,
    };

    if (update.status) updated.status = update.status;
    if (update.output !== undefined) updated.output = update.output;
    if (update.error !== undefined) updated.error = update.error;
    if (typeof update.latencyMs === 'number') updated.latencyMs = update.latencyMs;

    if (update.clientMetrics) {
      updated.input = updated.input ?? {};
      updated.input.clientMetrics = update.clientMetrics;
      if (typeof update.clientMetrics.totalMs === 'number') {
        updated.latencyMs = update.clientMetrics.totalMs;
      }
    }
    if (update.serverMetrics) {
      updated.input = updated.input ?? {};
      updated.input.serverMetrics = {
        ...(updated.input.serverMetrics ?? {}),
        ...update.serverMetrics,
      };
    }

    activityBus.update(userId, updated);
    this.persist(updated);
    return updated;
  }

  /**
   * Start logging an SDK operation. Returns a closure to call when the
   * operation completes (success or error).
   */
  startOperation(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
  ): { eventId: string; complete: CompleteOperation } {
    const event = this.createPending(userId, type, operation, input);
    const startTime = performance.now();

    const complete: CompleteOperation = (output, error, serverMetrics) => {
      const clientTotalMs = event.input?.clientMetrics?.totalMs;
      const latencyMs = clientTotalMs ?? Math.round(performance.now() - startTime);
      this.applyUpdate(userId, event.id, {
        status: error ? 'error' : 'success',
        output,
        error,
        latencyMs,
        serverMetrics,
      });
    };

    return { eventId: event.id, complete };
  }

  /**
   * Log a quick event that doesn't need timing (e.g. tool invocations).
   */
  logEvent(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
    output?: AIActivityOutput,
    status: AIActivityStatus = 'success',
  ): { eventId: string } {
    const event: AIActivityEvent = {
      id: this.generateId(),
      userId,
      timestamp: new Date(),
      type,
      operation,
      input,
      output,
      latencyMs: 0,
      status,
    };
    activityBus.append(userId, event);
    this.persist(event);
    return { eventId: event.id };
  }

  /**
   * Update an existing event with client-side metrics. Used by the
   * `/api/ai-activity/metrics` PATCH path so the browser can attach
   * end-to-end timing after the SSE stream completes.
   */
  updateWithClientMetrics(
    userId: string,
    eventId: string,
    clientMetrics: { firstTokenMs?: number; totalMs?: number },
  ): boolean {
    const updated = this.applyUpdate(userId, eventId, { clientMetrics });
    return updated !== null;
  }

  /** Snapshot of retained events for `userId`. */
  getEvents(userId: string): AIActivityEvent[] {
    return activityBus.snapshot(userId).filter((event) => event.userId === userId);
  }

  /** Get statistics about events visible to a specific user. */
  getStats(userId: string): AIActivityStats {
    const byType: Record<AIActivityType, number> = {
      embed: 0,
      ask: 0,
      session: 0,
      tool: 0,
      error: 0,
      internal: 0,
    };

    let totalLatency = 0;
    let totalTokens = 0;
    let count = 0;

    for (const event of this.getEvents(userId)) {
      count++;
      byType[event.type] = (byType[event.type] || 0) + 1;
      totalLatency += event.latencyMs;
      if (event.output?.tokens) {
        totalTokens += event.output.tokens.input + event.output.tokens.output;
      }
    }

    return {
      total: count,
      avgLatency: count > 0 ? Math.round(totalLatency / count) : 0,
      totalTokens,
      byType,
    };
  }

  /**
   * Clear all activity for `userId`: bus ring (with subscriber
   * notification), hydration marker, and durable store. Throws if the
   * durable store delete fails so the caller (web `/api/user/data`)
   * can surface a partial-failure response.
   */
  async clear(userId: string): Promise<void> {
    activityBus.clear(userId);
    this.hydrationByUser.delete(userId);
    await clearActivityEvents(userId);
  }

  /** Test helper: wipe ALL state, including the bus. */
  __resetForTests(): void {
    this.hydrationByUser.clear();
    activityBus.__resetForTests();
  }
}

/** Worker-only singleton. */
export const activityLoggerWorker = AIActivityLoggerWorker.getInstance();
export { AIActivityLoggerWorker };
