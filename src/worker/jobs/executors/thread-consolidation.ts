import type { Message } from '@/lib/threads';

export const STREAM_CURSOR = ' ▊';

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
  updatedMessages[existingIndex] = mergeExisting
    ? { ...updatedMessages[existingIndex], ...nextMessage }
    : nextMessage;
  return updatedMessages;
}
