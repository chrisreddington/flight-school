/**
 * Chat Stream Event Helpers
 *
 * Wire-format type for chat SSE frames plus pure dispatch helpers.
 * Lives in the hooks layer so the UI does not cross the
 * `@/worker/jobs/streaming/*` boundary.
 *
 * The `SSEStreamEvent` shape MUST stay in sync with
 * `src/worker/jobs/streaming/types.ts`.
 */

import { chatStreamStore, TERMINAL_SEQ } from '@/lib/chat/chat-stream-store';
import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import type { ToolCallEvent } from '@/lib/threads';

const log = logger.withTag('useLearningChat');

export type SSEStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_start'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_complete'; toolCallId: string; name: string; result: unknown; durationMs: number }
  | {
      type: 'state_snapshot';
      content: string;
      toolEvents: ToolCallEvent[];
      hasActionableItem: boolean;
    }
  | { type: 'done'; content: string; toolEvents: ToolCallEvent[]; hasActionableItem: boolean }
  | { type: 'cancelled'; content: string; toolEvents: ToolCallEvent[] }
  | { type: 'failed'; message: string };

/**
 * Build the terminal-frame handler for a single chat SSE subscription.
 *
 * Refresh durable threads BEFORE evicting the live record so a transient
 * refresh failure leaves the UI showing the last visible state and a
 * subsequent terminal replay can retry.
 */
export function buildTerminalHandler(
  jobId: string,
  terminalCleanupsRef: React.RefObject<Set<string>>,
  refreshThreads: () => Promise<void>,
): (terminalPayload?: SSEStreamEvent) => void {
  return (terminalPayload) => {
    if (terminalCleanupsRef.current.has(jobId)) return;
    terminalCleanupsRef.current.add(jobId);

    if (terminalPayload?.type === 'done') {
      chatStreamStore.applySnapshot(jobId, {
        content: terminalPayload.content,
        toolEvents: terminalPayload.toolEvents,
        hasActionableItem: terminalPayload.hasActionableItem,
        seq: TERMINAL_SEQ,
      });
    } else if (terminalPayload?.type === 'cancelled') {
      chatStreamStore.applySnapshot(jobId, {
        content: terminalPayload.content,
        toolEvents: terminalPayload.toolEvents,
        hasActionableItem: false,
        seq: TERMINAL_SEQ,
      });
    }

    refreshThreads()
      .then(() => {
        chatStreamStore.evict(jobId);
        operationsManager.completeExistingJob(jobId);
      })
      .catch((err: unknown) => {
        log.warn('refreshThreads failed during terminal cleanup; leaving live record in place for retry', {
          jobId,
          err,
        });
        terminalCleanupsRef.current.delete(jobId);
      });
  };
}

/**
 * Apply a parsed SSE frame to `chatStreamStore` or invoke the terminal
 * handler. Returns `true` for terminal frames so callers can close the
 * underlying subscription.
 */
export function dispatchFrame(
  jobId: string,
  parsed: SSEStreamEvent,
  seq: number,
  handleTerminal: (payload?: SSEStreamEvent) => void,
): boolean {
  switch (parsed.type) {
    case 'delta':
      chatStreamStore.applyDelta(jobId, parsed.content, seq);
      return false;
    case 'tool_start':
      chatStreamStore.applyToolStart(
        jobId,
        { toolCallId: parsed.toolCallId, name: parsed.name, args: parsed.args },
        seq,
      );
      return false;
    case 'tool_complete':
      chatStreamStore.applyToolComplete(
        jobId,
        {
          toolCallId: parsed.toolCallId,
          name: parsed.name,
          result: parsed.result,
          durationMs: parsed.durationMs,
        },
        seq,
      );
      return false;
    case 'state_snapshot':
      chatStreamStore.applySnapshot(jobId, {
        content: parsed.content,
        toolEvents: parsed.toolEvents,
        hasActionableItem: parsed.hasActionableItem,
        seq,
      });
      return false;
    case 'done':
    case 'cancelled':
    case 'failed':
      handleTerminal(parsed);
      return true;
  }
}
