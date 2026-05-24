import type { Message, ToolCallEvent } from '@/lib/threads/types';

/**
 * Inputs describing the current streaming state for the active thread.
 *
 * These mirror the props the chat component receives from the streaming
 * store, kept separate from the persisted `messages` so the synthesis
 * logic can be exercised without a React tree.
 */
export interface StreamingMessageState {
  /** True when the active thread has an in-flight assistant response. */
  isStreaming: boolean;
  /** Stable id of the in-flight assistant message (null when none). */
  assistantMessageId: string | null;
  /** Raw streaming buffer as emitted by the chat-stream store. */
  rawContent: string;
  /** Smoothed buffer used for actual rendering (keeps typing cadence steady). */
  smoothedContent: string;
  /** Tool events emitted by the in-flight job, if any. */
  toolEvents: ToolCallEvent[];
}

/**
 * Merge a live streaming assistant message into the persisted message list.
 *
 * The durable thread no longer holds a partial assistant message during
 * streaming (Phase 5), so the UI is responsible for blending the live
 * buffer in at render time. Returns `messages` unchanged whenever there
 * is nothing to synthesise, which keeps the consuming `useMemo` stable.
 */
export function mergeStreamingMessage(
  messages: Message[],
  state: StreamingMessageState,
): Message[] {
  if (!state.isStreaming) return messages;
  if (!state.assistantMessageId) return messages;

  const alreadyPresent = messages.some((m) => m.id === state.assistantMessageId);
  if (alreadyPresent) return messages;

  if (!state.rawContent && state.toolEvents.length === 0) return messages;

  const synthesized: Message = {
    id: state.assistantMessageId,
    role: 'assistant',
    content: state.smoothedContent,
    timestamp: new Date().toISOString(),
    toolEvents: state.toolEvents.length > 0 ? state.toolEvents : undefined,
  };
  return [...messages, synthesized];
}
