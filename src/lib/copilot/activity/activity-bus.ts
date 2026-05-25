/**
 * In-process pub/sub bus for per-user AI activity events.
 *
 * Lives only inside the worker process. The web tier reaches it via
 * the internal SSE endpoint at `/api/internal/ai-activity/stream`.
 * There is one ring buffer per user, capped at {@link MAX_EVENTS_PER_USER}.
 *
 * This file mirrors `src/worker/jobs/streaming/event-bus.ts` but is
 * keyed by `userId` instead of `jobId`. Events are addressed by their
 * opaque `event.id` (cursor / Last-Event-ID resume).
 *
 * Module boundary: nothing outside `src/worker/`, the activity logger
 * worker singleton, or `src/app/api/internal/ai-activity/` should
 * import this module.
 */
import { logger } from '@/lib/logger';
import type { AIActivityEvent } from './types';

const log = logger.withTag('ActivityBus');

export const MAX_EVENTS_PER_USER = 400;

export type ActivityBusFrame =
  | { type: 'init'; events: AIActivityEvent[]; cursor: string | null }
  | { type: 'event'; event: AIActivityEvent };

interface Subscriber {
  push: (frame: ActivityBusFrame) => void;
  closed: boolean;
}

interface UserBuffer {
  userId: string;
  /** Insertion-ordered list of retained events for this user. */
  events: AIActivityEvent[];
  /** Map from event.id → index in `events` for fast updates. */
  index: Map<string, number>;
  subscribers: Set<Subscriber>;
}

export class ActivityBus {
  private buffers = new Map<string, UserBuffer>();

  private getOrCreate(userId: string): UserBuffer {
    let buf = this.buffers.get(userId);
    if (!buf) {
      buf = {
        userId,
        events: [],
        index: new Map(),
        subscribers: new Set(),
      };
      this.buffers.set(userId, buf);
    }
    return buf;
  }

  /**
   * Append a NEW event for `userId` and broadcast it to live subscribers.
   * Idempotent on duplicate ids: ignores the call and warns. This guards
   * against hydration replays colliding with a live append for the same id.
   */
  append(userId: string, event: AIActivityEvent): void {
    const buf = this.getOrCreate(userId);
    if (buf.index.has(event.id)) {
      log.warn(`[bus] append called with existing id ${event.id} for ${userId} — ignored`);
      return;
    }
    buf.events.push(event);
    buf.index.set(event.id, buf.events.length - 1);
    if (buf.events.length > MAX_EVENTS_PER_USER) {
      const dropped = buf.events.shift()!;
      buf.index.delete(dropped.id);
      // Re-base indexes after evicting the head element.
      for (const [id, idx] of buf.index) {
        buf.index.set(id, idx - 1);
      }
    }
    this.broadcast(buf, { type: 'event', event });
  }

  /**
   * Seed retained events for `userId` from durable storage WITHOUT
   * broadcasting. Skips events whose id is already present in the
   * index so that a live `append()` that beat us to the bus is not
   * duplicated by hydration.
   */
  hydrate(userId: string, events: AIActivityEvent[]): void {
    const buf = this.getOrCreate(userId);
    for (const event of events) {
      if (buf.index.has(event.id)) continue;
      buf.events.push(event);
      buf.index.set(event.id, buf.events.length - 1);
      if (buf.events.length > MAX_EVENTS_PER_USER) {
        const dropped = buf.events.shift()!;
        buf.index.delete(dropped.id);
        for (const [id, idx] of buf.index) {
          buf.index.set(id, idx - 1);
        }
      }
    }
    // Intentionally no broadcast — hydration is a one-time fill, not
    // a stream of live events.
  }

  /**
   * Update an existing event in-place and broadcast the updated copy
   * as an `event` frame. Returns true when the event was retained and
   * updated, false otherwise (e.g. evicted from the ring).
   */
  update(userId: string, event: AIActivityEvent): boolean {
    const buf = this.buffers.get(userId);
    if (!buf) return false;
    const idx = buf.index.get(event.id);
    if (idx === undefined) return false;
    buf.events[idx] = event;
    this.broadcast(buf, { type: 'event', event });
    return true;
  }

  /**
   * Clear the retained ring for `userId` and broadcast a fresh `init`
   * frame to live subscribers WITHOUT closing them. New events posted
   * after the clear will resume on the existing subscriptions.
   */
  clear(userId: string): void {
    const buf = this.buffers.get(userId);
    if (!buf) return;
    buf.events = [];
    buf.index.clear();
    this.broadcast(buf, { type: 'init', events: [], cursor: null });
  }

  /** Snapshot of retained events for `userId`. */
  snapshot(userId: string): AIActivityEvent[] {
    const buf = this.buffers.get(userId);
    return buf ? [...buf.events] : [];
  }

  /** O(1) lookup by event id. Returns undefined when not retained. */
  getById(userId: string, eventId: string): AIActivityEvent | undefined {
    const buf = this.buffers.get(userId);
    if (!buf) return undefined;
    const idx = buf.index.get(eventId);
    return idx === undefined ? undefined : buf.events[idx];
  }

  /**
   * Resolve `cursor` (event.id) against the retained ring.
   * Returns:
   *  - `replay`: events at and after the cursor when the cursor was found.
   *    Replay is **inclusive** of the cursor event so a client that
   *    disconnected mid-pending can re-receive in-place updates (the
   *    bus stores one slot per id, so the retained copy is always the
   *    latest version). The client upserts by `event.id`, making the
   *    re-delivery idempotent.
   *  - `init`: the full retained set when the cursor was evicted/unknown
   *    (signals replace semantics to the subscriber).
   */
  resolveCursor(userId: string, cursor: string | null): { mode: 'replay' | 'init'; events: AIActivityEvent[] } {
    const buf = this.buffers.get(userId);
    const events = buf ? [...buf.events] : [];
    if (!cursor) return { mode: 'init', events };
    const idx = buf?.index.get(cursor);
    if (idx === undefined) {
      return { mode: 'init', events };
    }
    return { mode: 'replay', events: events.slice(idx) };
  }

  /**
   * Subscribe to events for `userId`. Returns an async iterator that
   * yields `ActivityBusFrame`s and an `unsubscribe` function. The
   * caller is expected to send an initial `init` frame before driving
   * this iterator (see `resolveCursor`).
   */
  subscribe(userId: string): {
    iterator: AsyncIterable<ActivityBusFrame>;
    unsubscribe: () => void;
  } {
    const buf = this.getOrCreate(userId);
    const queue: ActivityBusFrame[] = [];
    let waiter: ((value: IteratorResult<ActivityBusFrame>) => void) | null = null;
    let closed = false;

    const subscriber: Subscriber = {
      push: (frame) => {
        if (closed) return;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve({ value: frame, done: false });
        } else {
          queue.push(frame);
        }
      },
      closed: false,
    };

    buf.subscribers.add(subscriber);

    const unsubscribe = (): void => {
      if (closed) return;
      closed = true;
      subscriber.closed = true;
      buf.subscribers.delete(subscriber);
      if (waiter) {
        const resolve = waiter;
        waiter = null;
        resolve({ value: undefined, done: true });
      }
    };

    const iterator: AsyncIterable<ActivityBusFrame> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<ActivityBusFrame>> {
            if (queue.length > 0) {
              const value = queue.shift()!;
              return Promise.resolve({ value, done: false });
            }
            if (closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              waiter = resolve;
            });
          },
          return(): Promise<IteratorResult<ActivityBusFrame>> {
            unsubscribe();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };

    return { iterator, unsubscribe };
  }

  private broadcast(buf: UserBuffer, frame: ActivityBusFrame): void {
    for (const sub of buf.subscribers) {
      if (sub.closed) continue;
      try {
        sub.push(frame);
      } catch (err) {
        log.warn(`[bus] subscriber push failed for ${buf.userId}`, { err });
      }
    }
  }

  __resetForTests(): void {
    this.buffers.clear();
  }
}

export const activityBus = new ActivityBus();
