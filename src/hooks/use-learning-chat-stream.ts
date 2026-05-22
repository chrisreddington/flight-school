'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
import type { Message, Thread } from '@/lib/threads';
import { THREAD_DATA_CHANGED_EVENT, threadStore } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';

const log = logger.withTag('useLearningChat');

const STALE_STREAM_THRESHOLD_MS = 5_000;
const POLL_INTERVAL_MS = 400;

type PendingStreamMessages = Map<string, string>;

interface UseLearningChatStreamInput {
  threads: Thread[];
  activeThread: Thread | null;
  activeThreadId: string | null;
  isThreadsLoading: boolean;
  refreshThreads: () => Promise<void>;
  selectThread: (threadId: string) => void;
}

export function combineStreamingThreadIds(
  streamingThreadIds: string[],
  pendingStreamMessages: PendingStreamMessages,
): string[] {
  return Array.from(new Set([...streamingThreadIds, ...pendingStreamMessages.keys()]));
}

export function isThreadStreaming(
  activeThread: Thread | null,
  activeThreadId: string | null,
  pendingStreamMessages: PendingStreamMessages,
): boolean {
  return activeThread?.isStreaming === true ||
    (activeThreadId ? pendingStreamMessages.has(activeThreadId) : false);
}

export function getStreamingContent(activeThread: Thread | null): string {
  if (!activeThread?.isStreaming) return '';
  const streamingMessage = activeThread.messages.find(message => message.id.startsWith('streaming-'));
  return streamingMessage?.content ?? '';
}

export function finalizeInterruptedMessage(thread: Thread): Thread | null {
  const streamingMessage = thread.messages.find((message) =>
    message.id.startsWith('streaming-')
  );
  if (!streamingMessage) return null;

  const trimmedContent = streamingMessage.content.replace(' ▊', '').trim();
  const withoutStreaming = thread.messages.filter((message) => !message.id.startsWith('streaming-'));
  if (!trimmedContent) {
    return {
      ...thread,
      messages: withoutStreaming,
      updatedAt: now(),
      isStreaming: false,
    };
  }

  const interruptionNote = '*(Response interrupted)*';
  const content = streamingMessage.content.includes(interruptionNote)
    ? streamingMessage.content.replace(' ▊', '')
    : `${trimmedContent}\n\n${interruptionNote}`;
  const finalizedMessage: Message = {
    ...streamingMessage,
    id: generateMessageId(),
    content,
    timestamp: now(),
  };

  return {
    ...thread,
    messages: [...withoutStreaming, finalizedMessage],
    updatedAt: now(),
    isStreaming: false,
  };
}

export function useLearningChatStream({
  threads,
  activeThread,
  activeThreadId,
  isThreadsLoading,
  refreshThreads,
  selectThread,
}: UseLearningChatStreamInput) {
  const storageStreamingThreadIds = useMemo(() =>
    threads.filter(thread => thread.isStreaming === true).map(thread => thread.id),
    [threads]
  );
  const streamingThreadId = storageStreamingThreadIds[storageStreamingThreadIds.length - 1] ?? null;
  const [pendingStreamMessages, setPendingStreamMessages] = useState<PendingStreamMessages>(new Map());
  const allStreamingThreadIds = useMemo(
    () => combineStreamingThreadIds(storageStreamingThreadIds, pendingStreamMessages),
    [storageStreamingThreadIds, pendingStreamMessages],
  );
  const isStreaming = isThreadStreaming(activeThread, activeThreadId, pendingStreamMessages);
  const streamingContent = useMemo(() => getStreamingContent(activeThread), [activeThread]);

  useEffect(() => {
    if (allStreamingThreadIds.length === 0) return;

    log.debug('Starting polling for streaming threads', { count: allStreamingThreadIds.length });
    const pollInterval = setInterval(() => {
      refreshThreads();
    }, POLL_INTERVAL_MS);

    return () => {
      log.debug('Stopping polling for streaming threads');
      clearInterval(pollInterval);
    };
  }, [allStreamingThreadIds.length, refreshThreads]);

  useEffect(() => {
    if (pendingStreamMessages.size === 0) return;

    const stillPending = new Map<string, string>();
    for (const [threadId, userMessageId] of pendingStreamMessages) {
      const thread = threads.find(item => item.id === threadId);
      if (!thread) {
        stillPending.set(threadId, userMessageId);
        continue;
      }
      if (thread.isStreaming) continue;

      const hasStreamingMessage = thread.messages.some(message => message.id.startsWith('streaming-'));
      const userMessageIndex = thread.messages.findIndex(message => message.id === userMessageId);
      const hasNewResponse =
        userMessageIndex !== -1 &&
        thread.messages
          .slice(userMessageIndex + 1)
          .some(message => message.role === 'assistant' && !message.id.startsWith('streaming-'));
      if (!hasStreamingMessage && !hasNewResponse) {
        stillPending.set(threadId, userMessageId);
      }
    }

    if (stillPending.size !== pendingStreamMessages.size) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile pending stream tracking against storage updates
      setPendingStreamMessages(stillPending);
    }
  }, [threads, pendingStreamMessages]);

  useEffect(() => {
    if (isThreadsLoading) return;
    if (storageStreamingThreadIds.length === 0) return;
    if (activeThreadId) return;

    const latestStreamingId = storageStreamingThreadIds[storageStreamingThreadIds.length - 1];
    if (latestStreamingId) {
      selectThread(latestStreamingId);
    }
  }, [isThreadsLoading, storageStreamingThreadIds, activeThreadId, selectThread]);

  useEffect(() => {
    if (isThreadsLoading || threads.length === 0) return;

    const nowMs = Date.now();
    const updates = threads
      .map((thread) => finalizeStaleStream(thread, pendingStreamMessages, nowMs))
      .filter((thread): thread is Thread => Boolean(thread));

    if (updates.length === 0) return;

    void Promise.all(updates.map((thread) => threadStore.update(thread)));
  }, [isThreadsLoading, threads, pendingStreamMessages]);

  useEffect(() => {
    const handleThreadDataChanged = async (event: Event) => {
      const customEvent = event as CustomEvent<{ threadId?: string }>;
      const changedThreadId = customEvent.detail?.threadId;

      log.debug('Thread data changed event received', { changedThreadId });

      try {
        await refreshThreads();
        log.debug('Threads refreshed from storage after background job');
      } catch (err) {
        log.warn('Failed to refresh threads after background job', { err });
      }
    };

    window.addEventListener(THREAD_DATA_CHANGED_EVENT, handleThreadDataChanged);
    return () => {
      window.removeEventListener(THREAD_DATA_CHANGED_EVENT, handleThreadDataChanged);
    };
  }, [refreshThreads]);

  const markStreamPending = useCallback((threadId: string, userMessageId: string) => {
    setPendingStreamMessages(prev => new Map([...prev, [threadId, userMessageId]]));
  }, []);

  const clearPendingStream = useCallback((threadId: string) => {
    setPendingStreamMessages(prev => {
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  const stopStreaming = useCallback(async () => {
    const threadId = activeThreadId;
    if (!threadId) {
      log.warn('No active thread to stop streaming');
      return;
    }

    log.debug('Stopping stream for thread:', threadId);
    clearPendingStream(threadId);

    try {
      const jobsRes = await fetch('/api/jobs');
      if (jobsRes.ok) {
        const { jobs } = await jobsRes.json();
        const runningJobs = jobs.filter((job: { status: string; input?: { threadId?: string } }) =>
          job.status === 'running' &&
          job.input?.threadId === threadId
        );

        for (const job of runningJobs) {
          log.debug('Cancelling job:', job.id);
          await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
        }
      }

      const thread = await threadStore.getById(threadId);
      if (thread) {
        const updatedMessages = thread.messages.map(message => {
          if (message.id.startsWith('streaming-')) {
            const content = message.content.replace(' ▊', '').trim();
            return {
              ...message,
              id: generateMessageId(),
              content: content ? `${content}\n\n*(Response stopped)*` : '',
            };
          }
          return message;
        }).filter(message => message.content);

        await threadStore.update({
          ...thread,
          messages: updatedMessages,
          isStreaming: false,
          updatedAt: now(),
        });

        log.debug('Thread updated after stop');
      }

      await refreshThreads();
    } catch (err) {
      log.error('Failed to stop streaming:', err);
    }
  }, [activeThreadId, clearPendingStream, refreshThreads]);

  return {
    allStreamingThreadIds,
    clearPendingStream,
    isStreaming,
    markStreamPending,
    stopStreaming,
    streamingContent,
    streamingThreadId,
  };
}

function finalizeStaleStream(
  thread: Thread,
  pendingStreamMessages: PendingStreamMessages,
  nowMs: number,
): Thread | null {
  if (!thread.isStreaming) return null;
  if (pendingStreamMessages.has(thread.id)) return null;

  const hasStreamingMessage = thread.messages.some(message => message.id.startsWith('streaming-'));
  const isStale =
    nowMs - new Date(thread.updatedAt).getTime() > STALE_STREAM_THRESHOLD_MS;

  if (hasStreamingMessage) {
    if (!isStale) return null;
    return finalizeInterruptedMessage(thread);
  }

  return { ...thread, isStreaming: false, updatedAt: now() };
}
