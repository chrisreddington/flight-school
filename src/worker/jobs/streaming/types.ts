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

export interface JobStreamDeltaEvent {
  type: 'delta';
  /** Content chunk to append to the assistant message. */
  content: string;
}

export interface JobStreamToolStartEvent {
  type: 'tool_start';
  toolCallId: string;
  name: string;
  args: unknown;
}

export interface JobStreamToolCompleteEvent {
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

export interface JobStreamDoneEvent {
  type: 'done';
  content: string;
  toolEvents: ToolCallEvent[];
  hasActionableItem: boolean;
}

export interface JobStreamCancelledEvent {
  type: 'cancelled';
  content: string;
  toolEvents: ToolCallEvent[];
}

export interface JobStreamFailedEvent {
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

export type TerminalEventType = 'done' | 'cancelled' | 'failed';

export const TERMINAL_EVENT_TYPES: ReadonlySet<TerminalEventType> = new Set<TerminalEventType>([
  'done',
  'cancelled',
  'failed',
]);

export function isTerminalEvent(event: JobStreamEvent): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type as TerminalEventType);
}

export interface SequencedJobStreamEvent {
  seq: number;
  event: JobStreamEvent;
  byteSize: number;
}
