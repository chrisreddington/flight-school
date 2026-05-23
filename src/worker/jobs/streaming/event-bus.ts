/**
 * In-process pub/sub bus for per-job streaming events.
 *
 * Lives only inside the worker process. Web tier reaches it via an SSE
 * endpoint at `/api/internal/jobs/[id]/stream`. There is one ring buffer
 * per active job and one rolling `state_snapshot` per job.
 *
 * Module boundary: nothing outside `src/worker/` or `src/app/api/internal/`
 * should import from this module. Enforced by an architecture test.
 */

import { logger } from '@/lib/logger';
import { nowMs } from '@/lib/utils/date-utils';

import {
  isTerminalEvent,
  type JobStreamEvent,
  type JobStreamStateSnapshotEvent,
  type SequencedJobStreamEvent,
} from './types';

const log = logger.withTag('JobEventBus');

export const MAX_EVENTS_PER_JOB = 2_000;
export const MAX_BYTES_PER_JOB = 1_048_576;
export const MAX_EVENT_BYTES = 65_536;
export const TERMINAL_RETENTION_MS = 5 * 60 * 1000;

interface Subscriber {
  push: (event: SequencedJobStreamEvent) => void;
  closed: boolean;
}

interface JobBuffer {
  jobId: string;
  events: SequencedJobStreamEvent[];
  byteSize: number;
  lastSeq: number;
  /** Lowest seq still retained in `events` (or 0 if events is empty). */
  oldestSeq: number;
  snapshot: SequencedJobStreamEvent | null;
  terminated: boolean;
  terminatedAt: number | null;
  subscribers: Set<Subscriber>;
}

function approxJsonBytes(event: JobStreamEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

export class JobEventBus {
  private buffers = new Map<string, JobBuffer>();

  private getOrCreate(jobId: string): JobBuffer {
    let buf = this.buffers.get(jobId);
    if (!buf) {
      buf = {
        jobId,
        events: [],
        byteSize: 0,
        lastSeq: 0,
        oldestSeq: 0,
        snapshot: null,
        terminated: false,
        terminatedAt: null,
        subscribers: new Set(),
      };
      this.buffers.set(jobId, buf);
    }
    return buf;
  }

  /**
   * Truncate any event whose JSON representation exceeds {@link MAX_EVENT_BYTES}
   * BEFORE it reaches subscribers or the buffer/snapshot. This keeps both
   * live SSE frames and replay history strictly within caps.
   *
   * Truncation strategy:
   * - `delta`: trim `content` and append a marker. Sequence still consumed.
   * - `state_snapshot`: trim `content`; replace each oversized
   *   `toolEvents[].result` with a short JSON sentinel.
   * - `tool_complete`: replace `result` with a short sentinel if oversized.
   * - other event types: leave untouched (they are bounded by construction).
   */
  /**
   * Final invariant: ensure `approxJsonBytes(event) <= MAX_EVENT_BYTES`.
   * Returns either the original event or a small fallback that fits.
   * Used as the last step of `sanitize()` so every variant — including
   * `tool_start`, `done`, `cancelled` (which sanitize() does not branch on)
   * — is guaranteed to fit.
   */
  private clampToCap(event: JobStreamEvent): JobStreamEvent {
    if (approxJsonBytes(event) <= MAX_EVENT_BYTES) return event;
    // Bounded fallback per type — preserves the discriminator so consumers
    // still get correct terminal/intermediate semantics.
    switch (event.type) {
      case 'delta':
        return { type: 'delta', content: '[oversized delta dropped]' };
      case 'tool_start':
        return { type: 'tool_start', toolCallId: event.toolCallId, name: event.name, args: '[truncated]' };
      case 'tool_complete':
        return {
          type: 'tool_complete',
          toolCallId: event.toolCallId,
          name: event.name,
          result: '[truncated]',
          durationMs: event.durationMs,
        };
      case 'state_snapshot':
        return {
          type: 'state_snapshot',
          content: '[snapshot oversized; truncated]',
          toolEvents: [],
          hasActionableItem: event.hasActionableItem,
        };
      case 'done':
        return {
          type: 'done',
          content: '[final content too large; check job result]',
          toolEvents: [],
          hasActionableItem: event.hasActionableItem,
        };
      case 'cancelled':
        return { type: 'cancelled', content: '[content truncated]', toolEvents: [] };
      case 'failed':
        // failed.message bound is enforced here defensively.
        return { type: 'failed', message: event.message.slice(0, 4_096) };
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
  }

  private sanitize(event: JobStreamEvent): JobStreamEvent {
    if (approxJsonBytes(event) <= MAX_EVENT_BYTES) return event;
    let candidate: JobStreamEvent = event;
    if (event.type === 'delta') {
      const headroom = MAX_EVENT_BYTES - 64;
      const truncated = event.content.slice(0, Math.max(0, headroom));
      candidate = { type: 'delta', content: `${truncated}\u2026[truncated]` };
    } else if (event.type === 'state_snapshot') {
      // First pass: trim oversized tool results to a short sentinel.
      let safeContent =
        event.content.length > Math.floor(MAX_EVENT_BYTES / 2)
          ? `${event.content.slice(0, Math.floor(MAX_EVENT_BYTES / 2))}\u2026[truncated]`
          : event.content;
      let safeTools = event.toolEvents.map((t) => {
        const rawResult = typeof t.result === 'string' ? t.result : JSON.stringify(t.result ?? null);
        if (rawResult.length > 4_096) {
          return { ...t, result: `[truncated:${rawResult.length}b]` };
        }
        return t;
      });
      candidate = {
        type: 'state_snapshot',
        content: safeContent,
        toolEvents: safeTools,
        hasActionableItem: event.hasActionableItem,
      };
      // Iteratively shrink until under MAX_EVENT_BYTES. Strategies in order:
      //   a) shrink content by halving
      //   b) drop oldest tool events (keep newest, more relevant)
      //   c) finally clamp to empty toolEvents and a stub content
      let guard = 8;
      while (approxJsonBytes(candidate) > MAX_EVENT_BYTES && guard-- > 0) {
        if (safeContent.length > 256) {
          safeContent = `${safeContent.slice(0, Math.floor(safeContent.length / 2))}\u2026[truncated]`;
        } else if (safeTools.length > 1) {
          // Drop the OLDEST half so the most recent tool events remain visible.
          safeTools = safeTools.slice(Math.ceil(safeTools.length / 2));
        } else if (safeTools.length === 1) {
          safeTools = [];
        } else {
          safeContent = '[snapshot oversized; truncated]';
          break;
        }
        candidate = {
          type: 'state_snapshot',
          content: safeContent,
          toolEvents: safeTools,
          hasActionableItem: event.hasActionableItem,
        };
      }
    } else if (event.type === 'tool_complete') {
      candidate = {
        ...event,
        result: { truncated: true, originalType: typeof event.result },
      };
    }
    // Final invariant guarantee — covers any variant that the type-specific
    // arms above did not handle (e.g. tool_start, done, cancelled, failed)
    // AND any case where char-based slicing still left a multi-byte UTF-8
    // payload over the cap.
    return this.clampToCap(candidate);
  }

  append(jobId: string, event: JobStreamEvent): SequencedJobStreamEvent {
    const buf = this.getOrCreate(jobId);
    const seq = buf.lastSeq + 1;
    buf.lastSeq = seq;
    // Sanitize before subscribers OR storage observe the event so we
    // cannot blow through MAX_EVENT_BYTES anywhere downstream.
    const safeEvent = this.sanitize(event);
    const byteSize = approxJsonBytes(safeEvent);
    const sequenced: SequencedJobStreamEvent = { seq, event: safeEvent, byteSize };

    for (const sub of buf.subscribers) {
      if (!sub.closed) {
        try {
          sub.push(sequenced);
        } catch (err) {
          log.warn(`[bus] subscriber push failed for ${jobId}:`, err);
        }
      }
    }

    if (safeEvent.type === 'state_snapshot') {
      buf.snapshot = sequenced;
    }

    // NOTE: We do NOT coalesce consecutive deltas in the persisted history.
    // Deltas are append-only fragments from the consumer's perspective;
    // coalescing would force replay to emit cumulative content under a
    // single seq, which a reconnecting client (e.g. cursor=N after seeing
    // up to N) would then re-apply on top of its existing string -> dup.
    // Caps (events count + bytes) handle long-running streams via eviction
    // in `enforceCaps`, which is the correct boundary.
    buf.events.push(sequenced);
    buf.byteSize += byteSize;
    if (buf.events.length === 1) buf.oldestSeq = seq;

    if (isTerminalEvent(safeEvent)) {
      buf.terminated = true;
      buf.terminatedAt = nowMs();
    }

    this.enforceCaps(buf);
    return sequenced;
  }

  snapshot(jobId: string, snapshot: Omit<JobStreamStateSnapshotEvent, 'type'>): void {
    this.append(jobId, { type: 'state_snapshot', ...snapshot });
  }

  private enforceCaps(buf: JobBuffer): void {
    while (buf.events.length > MAX_EVENTS_PER_JOB || buf.byteSize > MAX_BYTES_PER_JOB) {
      const dropped = buf.events.shift();
      if (!dropped) break;
      buf.byteSize -= dropped.byteSize;
    }
    buf.oldestSeq = buf.events[0]?.seq ?? 0;
  }

  /**
   * Return events with sequence numbers strictly greater than `afterSeq`.
   *
   * Snapshot prepending semantics:
   * - `afterSeq === 0`: always include the snapshot (full replay).
   * - `afterSeq > 0` but `afterSeq < oldestRetained - 1`: cursor has fallen
   *   off the back of the buffer; include the snapshot so the client can
   *   rebuild state without missing the evicted range.
   * - otherwise: snapshot already covered; return tail only.
   */
  replay(jobId: string, afterSeq = 0): SequencedJobStreamEvent[] {
    const buf = this.buffers.get(jobId);
    if (!buf) return [];

    const oldestRetained = buf.oldestSeq;
    const cursorBehindBuffer = oldestRetained > 0 && afterSeq < oldestRetained - 1;
    const includeSnapshot =
      buf.snapshot !== null && (afterSeq === 0 || cursorBehindBuffer);

    if (includeSnapshot && buf.snapshot) {
      const snap = buf.snapshot;
      const tail = buf.events.filter((e) => e.seq > snap.seq && e.seq > afterSeq);
      return [snap, ...tail];
    }
    return buf.events.filter((e) => e.seq > afterSeq);
  }

  subscribe(jobId: string): {
    iterator: AsyncIterable<SequencedJobStreamEvent>;
    unsubscribe: () => void;
  } {
    const buf = this.getOrCreate(jobId);
    const queue: SequencedJobStreamEvent[] = [];
    let waiter: ((value: IteratorResult<SequencedJobStreamEvent>) => void) | null = null;
    let closed = false;

    const subscriber: Subscriber = {
      push: (event) => {
        if (closed) return;
        if (waiter) {
          const resolve = waiter;
          waiter = null;
          resolve({ value: event, done: false });
        } else {
          queue.push(event);
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

    const iterator: AsyncIterable<SequencedJobStreamEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<SequencedJobStreamEvent>> {
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
          return(): Promise<IteratorResult<SequencedJobStreamEvent>> {
            unsubscribe();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };

    return { iterator, unsubscribe };
  }

  isTerminated(jobId: string): boolean {
    return this.buffers.get(jobId)?.terminated ?? false;
  }

  /**
   * Append a terminal event only if the buffer has not already been
   * terminated. Idempotent: if a terminal frame has already been
   * recorded for this job (by the worker's happy path, by a concurrent
   * DELETE, or by `sweep()`), the call is a no-op and returns `null`.
   *
   * This is the single primitive both the worker executor's terminal
   * sequence AND the DELETE handler use to emit `done`/`cancelled`/
   * `failed` frames without racing.
   */
  appendTerminalIfNotTerminated(
    jobId: string,
    event: JobStreamEvent,
  ): SequencedJobStreamEvent | null {
    if (!isTerminalEvent(event)) {
      throw new Error(
        `appendTerminalIfNotTerminated requires a terminal event; got ${event.type}`,
      );
    }
    const existing = this.buffers.get(jobId);
    if (existing?.terminated) return null;
    return this.append(jobId, event);
  }

  /**
   * Whether the bus currently retains any state for the given job. Used by
   * the worker stream route to detect "terminal job, buffer already swept"
   * and synthesize a deterministic terminal SSE frame for late reconnects.
   */
  hasBuffer(jobId: string): boolean {
    return this.buffers.has(jobId);
  }

  sweep(now: number = nowMs()): number {
    let removed = 0;
    for (const [jobId, buf] of this.buffers.entries()) {
      if (buf.terminated && buf.terminatedAt !== null && now - buf.terminatedAt > TERMINAL_RETENTION_MS) {
        if (buf.subscribers.size === 0) {
          this.buffers.delete(jobId);
          removed += 1;
        }
      }
    }
    return removed;
  }

  __resetForTests(): void {
    this.buffers.clear();
  }
}

export const jobEventBus = new JobEventBus();
