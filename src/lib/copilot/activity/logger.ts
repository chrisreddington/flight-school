/**
 * AI Activity Logger
 * 
 * Singleton that captures all Copilot SDK operations for the Activity Panel.
 * Uses a circular buffer to prevent memory issues in long-running sessions.
 */

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';
import type {
    ActivityListener,
    AIActivityEvent,
    AIActivityInput,
    AIActivityOutput,
    AIActivityStats,
    AIActivityStatus,
    AIActivityType,
} from './types';

/** Function returned by startOperation to complete the event */
export type CompleteOperation = (output?: AIActivityOutput, error?: string) => void;

class AIActivityLogger {
  private static instance: AIActivityLogger;
  private events: AIActivityEvent[] = [];
  private listeners: Set<ActivityListener> = new Set();
  private maxEvents = 100; // Circular buffer size

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): AIActivityLogger {
    if (!AIActivityLogger.instance) {
      AIActivityLogger.instance = new AIActivityLogger();
    }
    return AIActivityLogger.instance;
  }

  /**
   * Start logging an SDK operation.
   * Returns a function to call when the operation completes.
   *
   * @param userId - Owner of this event. Required for multi-tenant
   *   filtering — events without an owning user are never surfaced via
   *   `/api/ai-activity`. Must come from a server-resolved identity
   *   (Auth.js session or a request-bound `SessionIdentity`), never from
   *   client input.
   */
  startOperation(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput
  ): CompleteOperation {
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

    this.addEvent(event);
    const startTime = performance.now();

    // Return completion function
    return (output?: AIActivityOutput, error?: string) => {
      // Use client total time if available (single source of truth for UI)
      // Otherwise fall back to server-side measurement
      const clientTotalMs = event.input?.clientMetrics?.totalMs;
      event.latencyMs = clientTotalMs ?? Math.round(performance.now() - startTime);
      
      event.output = output;
      event.error = error;
      event.status = error ? 'error' : 'success';
      
      // Notify listeners with a NEW object reference to ensure React detects the change
      // This prevents flakiness where React doesn't see mutations to the same object
      this.notifyListeners({ ...event });
    };
  }

  /**
   * Log a quick event that doesn't need timing (e.g., internal operations).
   *
   * @param userId - Owner of this event. Required for multi-tenant
   *   filtering. See {@link startOperation} for sourcing rules.
   */
  logEvent(
    userId: string,
    type: AIActivityType,
    operation: string,
    input?: AIActivityInput,
    output?: AIActivityOutput,
    status: AIActivityStatus = 'success'
  ): void {
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
    this.addEvent(event);
  }

  private generateId(): string {
    return `${nowMs()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private addEvent(event: AIActivityEvent): void {
    this.events.push(event);
    // Circular buffer - remove oldest if over limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
    // Notify with a new object reference for React change detection
    this.notifyListeners({ ...event });
  }

  private notifyListeners(event: AIActivityEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (e) {
        logger.error('Listener error', { error: e }, 'AIActivityLogger');
      }
    });
  }

  /**
   * Subscribe to activity events. Returns unsubscribe function.
   */
  subscribe(listener: ActivityListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get events visible to a specific user.
   *
   * Multi-tenant invariant: events without a userId or whose userId does
   * not match are never returned. Pass the userId resolved from
   * {@link requireUserContext} on every call.
   */
  getEvents(userId: string): AIActivityEvent[] {
    return this.events.filter(e => e.userId === userId);
  }

  /**
   * Get the most recently logged event ID for a specific user. Used by
   * streaming routes that need to correlate a just-started event back
   * to the client without leaking other tenants' IDs.
   */
  latestEventIdForUser(userId: string): string | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].userId === userId) {
        return this.events[i].id;
      }
    }
    return undefined;
  }

  /**
   * Internal: get all events regardless of owner. Tests and the in-memory
   * stats computation use this; **never** surface the result to a HTTP
   * response.
   */
  _getAllEventsUnscoped(): AIActivityEvent[] {
    return [...this.events];
  }

  /**
   * Get statistics about events visible to a specific user.
   *
   * Stats are computed only over events owned by `userId` so cross-tenant
   * counts and token totals never leak.
   */
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

    for (const event of this.events) {
      if (event.userId !== userId) continue;
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
   * Update an existing event with client-side metrics.
   * Used to add client-side performance data after streaming completes.
   *
   * @param userId - Owner of the event. Updates only succeed when the
   *   event's `userId` matches; cross-user updates are silently dropped.
   * @param eventId - The event ID to update
   * @param clientMetrics - Client-side performance metrics
   * @returns Whether the event was found, owned by `userId`, and updated.
   */
  updateWithClientMetrics(userId: string, eventId: string, clientMetrics: {
    firstTokenMs?: number;
    totalMs?: number;
  }): boolean {
    const event = this.events.find((e) => e.id === eventId);
    if (!event || event.userId !== userId) {
      return false;
    }

    // Add client metrics to event input
    if (!event.input) {
      event.input = {};
    }
    event.input.clientMetrics = clientMetrics;

    // Update latencyMs to reflect client total (single source of truth for UI)
    if (clientMetrics.totalMs != null) {
      event.latencyMs = clientMetrics.totalMs;
    }

    // Notify listeners with updated event
    this.notifyListeners({ ...event });
    return true;
  }

  /**
   * Clear events. When `userId` is provided, only that user's events are
   * removed; otherwise the whole buffer is wiped (process-shutdown / tests).
   */
  clear(userId?: string): void {
    if (userId) {
      this.events = this.events.filter(e => e.userId !== userId);
    } else {
      this.events = [];
    }
    // Notify listeners of clear (empty event)
    this.listeners.forEach((listener) => {
      try {
        listener({
          id: 'clear',
          userId: userId ?? '',
          timestamp: new Date(),
          type: 'internal',
          operation: 'clear',
          latencyMs: 0,
          status: 'success',
        });
      } catch {
        // Ignore listener errors on clear
      }
    });
  }
}

/** Singleton instance of the activity logger */
export const activityLogger = AIActivityLogger.getInstance();
