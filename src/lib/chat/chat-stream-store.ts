/**
 * Client-side in-memory store for live chat-stream state.
 *
 * Phase 5 of the streaming architecture refactor moves mid-stream
 * assistant content out of `threads.json` (worker no longer performs
 * 500 ms durable consolidations) and into this in-process store. The
 * store survives unmounts so cross-tab / route-change navigation can
 * resume a stream without losing buffered deltas.
 *
 * ## Sequence model
 *
 * Every `apply*` call carries a `seq` (the upstream SSE `lastEventId`).
 * The store only applies frames whose `seq > lastSeq` for that job; any
 * frame with `seq <= lastSeq` is dropped as a duplicate or out-of-order
 * replay. The TERMINAL snapshot uses `Number.MAX_SAFE_INTEGER` as a
 * sentinel — once written, no further mutations can override it. This
 * is intentional: terminal events arrive only once per job and any
 * late-arriving frame should be ignored.
 *
 * ## Lifecycle
 *
 * `register(jobId, threadId, assistantMessageId)` MUST be called before
 * the first delta for a job. If a stray apply* happens first (defensive
 * — should never occur in production) the store creates a synthetic
 * record with empty `threadId`/`assistantMessageId` and merges the
 * event so we never silently drop user-visible content.
 *
 * Records are evicted only by an explicit `evict(jobId)` — typically
 * the hook's terminal cleanup, AFTER `refreshThreads()` succeeds so
 * the durable thread has assumed responsibility for the final content.
 *
 * @module chat/chat-stream-store
 */

'use client';

import type { ToolCallEvent } from '@/lib/threads';

/** Sentinel sequence number used by terminal `applySnapshot` calls. */
export const TERMINAL_SEQ = Number.MAX_SAFE_INTEGER;

export interface ChatStreamState {
  jobId: string;
  threadId: string;
  assistantMessageId: string | null;
  content: string;
  toolEvents: ToolCallEvent[];
  hasActionableItem: boolean;
  /** Highest applied seq for this job. */
  lastSeq: number;
}

type ChatStreamListener = () => void;

interface ToolStartPayload {
  toolCallId: string;
  name: string;
  args: unknown;
}

interface ToolCompletePayload {
  toolCallId: string;
  name: string;
  result: unknown;
  durationMs: number;
}

interface SnapshotPayload {
  content: string;
  toolEvents: ToolCallEvent[];
  hasActionableItem: boolean;
  seq: number;
}

class ChatStreamStore {
  private records = new Map<string, ChatStreamState>();
  /** Ref-swapped on every mutation so `useSyncExternalStore` detects change. */
  private snapshot: ReadonlyMap<string, ChatStreamState> = this.records;
  private listeners = new Set<ChatStreamListener>();

  subscribe(listener: ChatStreamListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ReadonlyMap<string, ChatStreamState> {
    return this.snapshot;
  }

  getByJobId(jobId: string): ChatStreamState | null {
    return this.records.get(jobId) ?? null;
  }

  getByThreadId(threadId: string): ChatStreamState | null {
    for (const rec of this.records.values()) {
      if (rec.threadId === threadId) return rec;
    }
    return null;
  }

  register(jobId: string, threadId: string, assistantMessageId: string): void {
    const existing = this.records.get(jobId);
    if (existing) {
      // Never let a later caller with an empty id clobber a previously
      // registered stable id — `useLearningChat.sendMessage` seeds the
      // store first with a real id, then `registerExistingJob` runs;
      // if the SSE-subscribe effect re-reads stale operation metadata
      // it must not downgrade the stored value to ''.
      const nextId = assistantMessageId || existing.assistantMessageId;
      this.records.set(jobId, { ...existing, threadId, assistantMessageId: nextId });
    } else {
      this.records.set(jobId, {
        jobId,
        threadId,
        assistantMessageId,
        content: '',
        toolEvents: [],
        hasActionableItem: false,
        lastSeq: 0,
      });
    }
    this.notify();
  }

  applyDelta(jobId: string, content: string, seq: number): void {
    const rec = this.ensure(jobId);
    if (seq <= rec.lastSeq) return;
    this.records.set(jobId, { ...rec, content: rec.content + content, lastSeq: seq });
    this.notify();
  }

  applyToolStart(jobId: string, payload: ToolStartPayload, seq: number): void {
    const rec = this.ensure(jobId);
    if (seq <= rec.lastSeq) return;
    const nextEvents: ToolCallEvent[] = [
      ...rec.toolEvents,
      { id: payload.toolCallId, name: payload.name, status: 'running', args: payload.args },
    ];
    this.records.set(jobId, { ...rec, toolEvents: nextEvents, lastSeq: seq });
    this.notify();
  }

  applyToolComplete(jobId: string, payload: ToolCompletePayload, seq: number): void {
    const rec = this.ensure(jobId);
    if (seq <= rec.lastSeq) return;
    const nextEvents = rec.toolEvents.map((evt) => {
      if (evt.id !== payload.toolCallId) return evt;
      return {
        ...evt,
        status: 'complete' as const,
        result: typeof payload.result === 'string' ? payload.result : JSON.stringify(payload.result ?? null),
        durationMs: payload.durationMs,
      };
    });
    this.records.set(jobId, { ...rec, toolEvents: nextEvents, lastSeq: seq });
    this.notify();
  }

  applySnapshot(jobId: string, payload: SnapshotPayload): void {
    const rec = this.ensure(jobId);
    if (payload.seq <= rec.lastSeq) return;
    this.records.set(jobId, {
      ...rec,
      content: payload.content,
      toolEvents: payload.toolEvents.map((e) => ({ ...e })),
      hasActionableItem: payload.hasActionableItem,
      lastSeq: payload.seq,
    });
    this.notify();
  }

  evict(jobId: string): void {
    if (!this.records.has(jobId)) return;
    this.records.delete(jobId);
    this.notify();
  }

  __resetForTests(): void {
    this.records.clear();
    this.snapshot = this.records;
    this.listeners.clear();
  }

  private ensure(jobId: string): ChatStreamState {
    const existing = this.records.get(jobId);
    if (existing) return existing;
    const blank: ChatStreamState = {
      jobId,
      threadId: '',
      assistantMessageId: null,
      content: '',
      toolEvents: [],
      hasActionableItem: false,
      lastSeq: 0,
    };
    this.records.set(jobId, blank);
    return blank;
  }

  private notify(): void {
    this.snapshot = new Map(this.records);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore listener errors
      }
    }
  }
}

export const chatStreamStore = new ChatStreamStore();
