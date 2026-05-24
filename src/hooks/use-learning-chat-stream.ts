/**
 * useLearningChatStream Hook
 *
 * Thin coordinator for chat streaming state. Composes
 * `useChatSseSubscriptions`, `usePendingStreamReconciler`, and
 * `useOrphanedChatStreamFinalizer`; derives the streaming-thread sets;
 * exposes the public actions consumed by `useLearningChat` and the
 * `LearningChat` component.
 */

'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { apiDelete, apiGet } from '@/lib/api-client';
import { chatStreamStore, type ChatStreamState } from '@/lib/chat/chat-stream-store';
import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import type { ToolCallEvent } from '@/lib/threads';
import { THREAD_DATA_CHANGED_EVENT, type Thread } from '@/lib/threads';

import { useChatSseSubscriptions } from './use-chat-sse-subscriptions';
import {
  usePendingStreamReconciler,
  type PendingStreamMessages,
} from './use-pending-stream-reconciler';
import { useOrphanedChatStreamFinalizer } from './use-orphaned-chat-stream-finalizer';

const log = logger.withTag('useLearningChat');

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
  return (
    activeThread?.isStreaming === true ||
    (activeThreadId ? pendingStreamMessages.has(activeThreadId) : false)
  );
}

/**
 * Read the in-flight assistant content for the given thread from the
 * client-side chat-stream store. The worker does not write mid-stream
 * content into the durable thread, so this store — not `Thread.messages` —
 * is the canonical source for any partial assistant message that is
 * still streaming.
 */
function getStreamingContentForThread(
  streamRecords: ReadonlyMap<string, ChatStreamState>,
  threadId: string | null,
): { content: string; assistantMessageId: string | null; toolEvents: ToolCallEvent[] } {
  if (!threadId) return { content: '', assistantMessageId: null, toolEvents: [] };
  for (const rec of streamRecords.values()) {
    if (rec.threadId !== threadId) continue;
    return {
      content: rec.content,
      assistantMessageId: rec.assistantMessageId,
      toolEvents: rec.toolEvents,
    };
  }
  return { content: '', assistantMessageId: null, toolEvents: [] };
}

export function useLearningChatStream({
  threads,
  activeThread,
  activeThreadId,
  isThreadsLoading,
  refreshThreads,
  selectThread,
}: UseLearningChatStreamInput) {
  const storageStreamingThreadIds = useMemo(
    () => threads.filter((thread) => thread.isStreaming === true).map((thread) => thread.id),
    [threads],
  );
  const streamingThreadId = storageStreamingThreadIds[storageStreamingThreadIds.length - 1] ?? null;
  const [pendingStreamMessages, setPendingStreamMessages] = useState<PendingStreamMessages>(
    new Map(),
  );

  // Subscribe to the chat-stream store so any delta/snapshot from the SSE
  // handler triggers a re-render with the latest live content for the
  // active thread.
  const streamRecords = useSyncExternalStore(
    chatStreamStore.subscribe.bind(chatStreamStore),
    () => chatStreamStore.getSnapshot(),
    () => chatStreamStore.getSnapshot(),
  );
  const {
    content: streamingContent,
    assistantMessageId: streamingAssistantMessageId,
    toolEvents: streamingToolEvents,
  } = useMemo(
    () => getStreamingContentForThread(streamRecords, activeThreadId),
    [streamRecords, activeThreadId],
  );

  // Ensure operationsManager has had a chance to hydrate from the
  // server-side job list on page load.
  useEffect(() => {
    void operationsManager.initialize();
  }, []);

  // Subscribe to operationsManager so the SSE-attach effect re-runs when a
  // new chat job is registered via `registerExistingJob` AFTER this hook
  // has already observed the corresponding streaming thread id.
  const opsSnapshot = useSyncExternalStore(
    operationsManager.subscribe.bind(operationsManager),
    () => operationsManager.getSnapshot(),
    () => operationsManager.getSnapshot(),
  );

  // Active chat operations are the PRIMARY signal that a thread is
  // streaming. `thread.isStreaming` is a fallback for the brief window
  // between user-send and op registration; `pendingStreamMessages` covers
  // the period before storage has caught up. Cold-tab reloads land here
  // with chat ops hydrated from the job list — without them in this set
  // the SSE effect would never attach.
  const opStreamingThreadIds = useMemo(() => {
    const out: string[] = [];
    for (const op of opsSnapshot.chatMessages.values()) {
      const threadId = op.meta.targetId;
      if (threadId) out.push(threadId);
    }
    return out;
  }, [opsSnapshot]);

  const allStreamingThreadIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...opStreamingThreadIds,
          ...storageStreamingThreadIds,
          ...pendingStreamMessages.keys(),
        ]),
      ),
    [opStreamingThreadIds, storageStreamingThreadIds, pendingStreamMessages],
  );

  // Stable string key derived from sorted ids so the SSE effect below only
  // re-runs when the set of streaming threads actually changes (array
  // identity is unstable across renders even when contents match).
  const streamingThreadIdsKey = useMemo(
    () => [...allStreamingThreadIds].sort().join(','),
    [allStreamingThreadIds],
  );
  const isStreaming =
    isThreadStreaming(activeThread, activeThreadId, pendingStreamMessages) ||
    (activeThreadId !== null && opStreamingThreadIds.includes(activeThreadId));

  const chatSubscriptionKey = useMemo(() => {
    const idSet = new Set(allStreamingThreadIds);
    const pairs: string[] = [];
    for (const op of opsSnapshot.chatMessages.values()) {
      const jobId = op.meta.jobId;
      const threadId = op.meta.targetId;
      if (!jobId || !threadId) continue;
      if (!idSet.has(threadId)) continue;
      pairs.push(`${threadId}:${jobId}`);
    }
    return pairs.sort().join(',');
  }, [opsSnapshot, allStreamingThreadIds]);

  const reconnectingJobIds = useChatSseSubscriptions(
    streamingThreadIdsKey,
    chatSubscriptionKey,
    refreshThreads,
  );
  usePendingStreamReconciler(pendingStreamMessages, setPendingStreamMessages, threads);
  useOrphanedChatStreamFinalizer(isThreadsLoading, threads, pendingStreamMessages, opsSnapshot);

  // Auto-select the most recently streaming thread on load when nothing is
  // selected — gives a useful default after page refresh.
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
    setPendingStreamMessages((prev) => new Map([...prev, [threadId, userMessageId]]));
  }, []);

  const clearPendingStream = useCallback((threadId: string) => {
    setPendingStreamMessages((prev) => {
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  const registerStream = useCallback(
    (jobId: string, threadId: string, assistantMessageId: string) => {
      chatStreamStore.register(jobId, threadId, assistantMessageId);
    },
    [],
  );

  const stopStreaming = useCallback(async () => {
    const threadId = activeThreadId;
    if (!threadId) {
      log.warn('No active thread to stop streaming');
      return;
    }

    log.debug('Stopping stream for thread:', threadId);
    clearPendingStream(threadId);

    // Client only fires the DELETE; the worker writes the
    // `*(Response stopped)*` annotation into the durable thread as part of
    // its terminal sequence. Writing here would double-tag.
    try {
      const { jobs } = await apiGet<{ jobs: Array<{ id: string; status: string; type?: string; targetId?: string }> }>(
        '/api/jobs',
      );
      const runningJobs = jobs.filter(
        (job) =>
          job.status === 'running' && job.type === 'chat-response' && job.targetId === threadId,
      );

      await Promise.all(
        runningJobs.map((job) => {
          log.debug('Cancelling job:', job.id);
          return apiDelete(`/api/jobs/${job.id}`);
        }),
      );
    } catch (err) {
      log.error('Failed to stop streaming:', err);
    }
  }, [activeThreadId, clearPendingStream]);

  return {
    allStreamingThreadIds,
    clearPendingStream,
    isStreaming,
    markStreamPending,
    reconnectingJobIds,
    registerStream,
    stopStreaming,
    streamingAssistantMessageId,
    streamingContent,
    streamingThreadId,
    streamingToolEvents,
  };
}
