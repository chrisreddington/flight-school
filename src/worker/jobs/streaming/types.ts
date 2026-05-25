/**
 * Streaming event types emitted by worker job executors and consumed by the
 * web tier via SSE.
 *
 * Sequence numbers are assigned by the bus (not the producer); each job has
 * its own monotonic sequence starting at 1. The first event a subscriber
 * sees after replaying buffered history is always the most recent
 * `state_snapshot` (if any), followed by any subsequent events.
 */

import type { ToolCallEvent } from '@/lib/threads';

interface JobStreamDeltaEvent {
  type: 'delta';
  /** Content chunk to append to the assistant message. */
  content: string;
}

interface JobStreamToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  name: string;
  args: unknown;
}

interface JobStreamToolCompleteEvent {
  type: 'tool_complete';
  toolCallId: string;
  name: string;
  result: unknown;
  durationMs: number;
}

export interface JobStreamStateSnapshotEvent {
  type: 'state_snapshot';
  content: string;
  toolEvents: ToolCallEvent[];
  hasActionableItem: boolean;
}

interface JobStreamDoneEvent {
  type: 'done';
  content: string;
  toolEvents: ToolCallEvent[];
  hasActionableItem: boolean;
}

interface JobStreamCancelledEvent {
  type: 'cancelled';
  content: string;
  toolEvents: ToolCallEvent[];
}

interface JobStreamFailedEvent {
  type: 'failed';
  message: string;
}

export type JobStreamEvent =
  | JobStreamDeltaEvent
  | JobStreamToolStartEvent
  | JobStreamToolCompleteEvent
  | JobStreamStateSnapshotEvent
  | JobStreamDoneEvent
  | JobStreamCancelledEvent
  | JobStreamFailedEvent;

type TerminalEventType = 'done' | 'cancelled' | 'failed';

const TERMINAL_EVENT_TYPES: ReadonlySet<TerminalEventType> = new Set<TerminalEventType>([
  'done',
  'cancelled',
  'failed',
]);

export function isTerminalEvent(event: JobStreamEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type as TerminalEventType);
}

/**
 * Map a terminal job status into the corresponding {@link JobStreamEvent}.
 *
 * Used by the worker terminal sequence so the same helper drives
 * `appendTerminalIfNotTerminated` from both the happy path and the
 * catch/cancellation branches.
 *
 * `completed` → `done`, `cancelled` → `cancelled`, `failed` → `failed`.
 */
export function terminalEventFromStatus(
  status: 'completed' | 'cancelled' | 'failed',
  payload: { content?: string; toolEvents?: import('@/lib/threads').ToolCallEvent[]; hasActionableItem?: boolean; message?: string },
): JobStreamEvent {
  switch (status) {
    case 'completed':
      return {
        type: 'done',
        content: payload.content ?? '',
        toolEvents: payload.toolEvents ?? [],
        hasActionableItem: payload.hasActionableItem ?? false,
      };
    case 'cancelled':
      return {
        type: 'cancelled',
        content: payload.content ?? '',
        toolEvents: payload.toolEvents ?? [],
      };
    case 'failed':
      return { type: 'failed', message: payload.message ?? 'unknown error' };
  }
}

export interface SequencedJobStreamEvent {
  seq: number;
  event: JobStreamEvent;
  byteSize: number;
}
