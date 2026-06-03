import type { Message, ToolCallEvent } from '@/lib/threads';

/**
 * Returns copies of `events` with any lingering `running` status coerced to
 * `complete`. A tool that never received a matching `tool_complete` (e.g. the
 * `skill` tool) would otherwise persist as `running` and render a perpetual
 * spinner after the thread reloads. The turn is over by the time we finalize,
 * so any still-running tool has effectively finished. Pure — never mutates
 * the input.
 */
export function finalizeToolEvents(events: ToolCallEvent[]): ToolCallEvent[] {
  return events.map((event) => (event.status === 'running' ? { ...event, status: 'complete' } : { ...event }));
}

/**
 * Upsert `nextMessage` into `messages` by id. When `mergeExisting` is
 * true the existing entry is spread-merged with `nextMessage`; when
 * false it is fully replaced. Pure — never writes anything.
 */
export function upsertMessageById(
  messages: Message[],
  messageId: string,
  nextMessage: Message,
  mergeExisting: boolean,
): Message[] {
  const existingIndex = messages.findIndex((m) => m.id === messageId);
  if (existingIndex < 0) {
    return [...messages, nextMessage];
  }

  const updatedMessages = [...messages];
  updatedMessages[existingIndex] = mergeExisting ? { ...updatedMessages[existingIndex], ...nextMessage } : nextMessage;
  return updatedMessages;
}
