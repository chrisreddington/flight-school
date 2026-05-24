/**
 * usePendingStreamReconciler Hook
 *
 * Reconcile the in-memory `pendingStreamMessages` map against durable
 * threads: a thread leaves the pending set once it is no longer marked
 * `isStreaming` AND has an assistant message after the user's send.
 * Extracted from `useLearningChatStream`.
 */

'use client';

import { useEffect } from 'react';

import type { Thread } from '@/lib/threads';

export type PendingStreamMessages = Map<string, string>;

export function usePendingStreamReconciler(
  pendingStreamMessages: PendingStreamMessages,
  setPendingStreamMessages: React.Dispatch<React.SetStateAction<PendingStreamMessages>>,
  threads: Thread[],
): void {
  useEffect(() => {
    if (pendingStreamMessages.size === 0) return;

    const stillPending = new Map<string, string>();
    for (const [threadId, userMessageId] of pendingStreamMessages) {
      const thread = threads.find((threadCandidate) => threadCandidate.id === threadId);
      if (!thread) {
        stillPending.set(threadId, userMessageId);
        continue;
      }
      if (thread.isStreaming) continue;

      const userMessageIndex = thread.messages.findIndex((message) => message.id === userMessageId);
      const hasNewResponse =
        userMessageIndex !== -1 &&
        thread.messages.slice(userMessageIndex + 1).some((message) => message.role === 'assistant');
      if (!hasNewResponse) {
        stillPending.set(threadId, userMessageId);
      }
    }

    if (stillPending.size !== pendingStreamMessages.size) {
      setPendingStreamMessages(stillPending);
    }
  }, [threads, pendingStreamMessages, setPendingStreamMessages]);
}
