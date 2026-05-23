import { deleteScratchpad, readScratchpad } from '@/lib/storage/scratchpad';
import type { Message } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';
import { getThreadById, updateThread } from '@/lib/jobs/storage/threads-storage';

export const STREAM_CURSOR = ' ▊';

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

/**
 * Merge a per-job scratchpad into `threads.json`, then delete the scratchpad.
 * Upserts by assistant message id, so re-running is idempotent.
 */
export async function consolidateScratchpadToThread(
  userId: string,
  jobId: string,
  isFinal: boolean,
): Promise<void> {
  const scratchpad = await readScratchpad(userId, jobId);
  if (!scratchpad) return;
  const { threadId, assistantMessageId, content, toolEvents, hasActionableItem } = scratchpad;

  const currentThread = await getThreadById(userId, threadId);
  if (!currentThread) {
    await deleteScratchpad(userId, jobId);
    return;
  }

  const consolidatedMessage: Message = {
    id: assistantMessageId,
    role: 'assistant',
    content: content + (isFinal ? '' : STREAM_CURSOR),
    timestamp: now(),
    toolEvents: toolEvents && toolEvents.length > 0 ? toolEvents.map((e) => ({ ...e })) : undefined,
    hasActionableItem,
  };

  const updatedMessages = upsertMessageById(
    currentThread.messages,
    assistantMessageId,
    consolidatedMessage,
    true,
  );

  await updateThread(userId, {
    ...currentThread,
    messages: updatedMessages,
    updatedAt: now(),
    isStreaming: !isFinal,
  });

  await deleteScratchpad(userId, jobId);
}
