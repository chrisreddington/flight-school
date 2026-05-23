'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import type { Message, Thread } from '@/lib/threads';
import { THREAD_DATA_CHANGED_EVENT, threadStore } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';

const log = logger.withTag('useLearningChat');

const STALE_STREAM_THRESHOLD_MS = 5_000;

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

const STREAM_CURSOR_GLYPH = '▊';

function hasStreamCursor(content: string): boolean {
  return content.includes(STREAM_CURSOR_GLYPH);
}

export function getStreamingContent(activeThread: Thread | null): string {
  if (!activeThread?.isStreaming) return '';
  // Worker writes the in-flight assistant message under its stable
  // assistantMessageId UUID with a trailing STREAM_CURSOR glyph during
  // periodic durable consolidation. The legacy `streaming-*` placeholder
  // ID prefix is no longer produced by any code path.
  const streamingMessage = activeThread.messages.find(
    (message) => message.role === 'assistant' && hasStreamCursor(message.content),
  );
  return streamingMessage?.content ?? '';
}

export function finalizeInterruptedMessage(thread: Thread): Thread | null {
  const streamingIdx = thread.messages.findIndex(
    (message) => message.role === 'assistant' && hasStreamCursor(message.content),
  );
  if (streamingIdx === -1) return null;
  const streamingMessage = thread.messages[streamingIdx];

  const trimmedContent = streamingMessage.content.replace(' ▊', '').replace('▊', '').trim();
  const withoutStreaming = thread.messages.filter((_, i) => i !== streamingIdx);
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
    ? streamingMessage.content.replace(' ▊', '').replace('▊', '')
    : `${trimmedContent}\n\n${interruptionNote}`;
  const finalizedMessage: Message = {
    ...streamingMessage,
    content,
    timestamp: now(),
  };

  const finalizedMessages = [...thread.messages];
  finalizedMessages[streamingIdx] = finalizedMessage;

  return {
    ...thread,
    messages: finalizedMessages,
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
  // Stable string key derived from sorted ids so the SSE effect below only
  // re-runs when the set of streaming threads actually changes (array
  // identity is unstable across renders even when contents match).
  const streamingThreadIdsKey = useMemo(
    () => [...allStreamingThreadIds].sort().join(','),
    [allStreamingThreadIds],
  );
  const isStreaming = isThreadStreaming(activeThread, activeThreadId, pendingStreamMessages);
  const streamingContent = useMemo(() => getStreamingContent(activeThread), [activeThread]);

  // Ensure operationsManager has had a chance to hydrate from the
  // server-side job list on page load. This is also called from
  // `useActiveOperations`, but doing it here makes the chat stream hook
  // self-sufficient (it doesn't rely on a sibling hook mounting first).
  useEffect(() => {
    void operationsManager.initialize();
  }, []);

  // Subscribe to operationsManager so the SSE-attach effect re-runs when
  // a new chat job is registered via `registerExistingJob` AFTER this
  // hook has already observed the corresponding streaming thread id.
  // Without this, the effect could race: pending-thread id appears →
  // effect runs → snapshot has no chat op yet → no EventSource opens →
  // later registration never re-triggers attachment because
  // streamingThreadIdsKey hasn't changed.
  const opsSnapshot = useSyncExternalStore(
    operationsManager.subscribe.bind(operationsManager),
    () => operationsManager.getSnapshot(),
    () => operationsManager.getSnapshot(),
  );
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

  useEffect(() => {
    const ids = streamingThreadIdsKey ? streamingThreadIdsKey.split(',') : [];
    if (ids.length === 0) return;
    if (!chatSubscriptionKey) return;

    log.debug('Subscribing to SSE streams', { count: ids.length });
    const sources: EventSource[] = [];
    let disposed = false;

    // Coalesce refreshThreads calls — the SSE handler fires on every
    // frame (including deltas) and we don't need a full thread refetch
    // that often. ~400ms keeps the UI responsive without hammering
    // /api/learning/threads on a token stream.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = (): void => {
      if (refreshTimer !== null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshThreads();
      }, 400);
    };

    void (async () => {
      const cursorMod = await import('@/lib/streaming/cursor-store');
      if (disposed) return;
      const { getCursor, setCursor, evictCursor } = cursorMod;

      const snapshot = operationsManager.getSnapshot();
      const subscribedJobIds = new Set<string>();
      const idSet = new Set(ids);

      for (const op of snapshot.chatMessages.values()) {
        const jobId = op.meta.jobId;
        const threadId = op.meta.targetId;
        if (!jobId || !threadId) continue;
        if (!idSet.has(threadId)) continue;
        if (subscribedJobIds.has(jobId)) continue;
        subscribedJobIds.add(jobId);

        const cursor = getCursor(jobId);
        const url = `/api/jobs/${encodeURIComponent(jobId)}/stream${cursor > 0 ? `?cursor=${cursor}` : ''}`;
        const es = new EventSource(url, { withCredentials: true });
        es.onmessage = (msg) => {
          const me = msg as MessageEvent;
          if (me.lastEventId) {
            const parsed = Number.parseInt(me.lastEventId, 10);
            if (Number.isFinite(parsed)) setCursor(jobId, parsed);
          }
          if (me.data === '[DONE]') {
            evictCursor(jobId);
            es.close();
            // Terminal cleanup: remove the chat operation from
            // operationsManager so a subsequent message in the same
            // thread can register a fresh op without the old one's
            // stale jobId leaking into the SSE subscription.
            operationsManager.completeExistingJob(jobId);
            // Refresh immediately (no throttle) so the UI settles
            // fast on the final assistant message.
            if (refreshTimer !== null) {
              clearTimeout(refreshTimer);
              refreshTimer = null;
            }
            void refreshThreads();
            return;
          }
          scheduleRefresh();
        };
        es.onerror = () => {
          // EventSource auto-reconnects; refresh so any thread updates are visible.
          scheduleRefresh();
        };
        sources.push(es);
      }
    })();

    return () => {
      disposed = true;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      log.debug('Closing SSE subscriptions', { count: sources.length });
      for (const es of sources) es.close();
    };
  }, [streamingThreadIdsKey, chatSubscriptionKey, refreshThreads]);

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

      // After the SSE [DONE] handler and worker's terminal consolidate,
      // the assistant message lives under its assistantMessageId (a
      // UUID) with no STREAM_CURSOR. A stream is considered settled
      // when isStreaming is false AND there is no cursor-suffixed
      // partial message remaining. A second condition — an assistant
      // message after the user's message — handles the happy path
      // where the worker finalised cleanly.
      const hasStreamingMessage = thread.messages.some(
        (message) => message.role === 'assistant' && hasStreamCursor(message.content),
      );
      const userMessageIndex = thread.messages.findIndex(message => message.id === userMessageId);
      const hasNewResponse =
        userMessageIndex !== -1 &&
        thread.messages
          .slice(userMessageIndex + 1)
          .some((message) => message.role === 'assistant' && !hasStreamCursor(message.content));
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
        // After Phase 2B the list DTO redacts `input` entirely, so use
        // the top-level `targetId` field — chat-response jobs set
        // `targetId` to the thread id at creation.
        const runningJobs = jobs.filter((job: { status: string; type?: string; targetId?: string }) =>
          job.status === 'running' &&
          job.type === 'chat-response' &&
          job.targetId === threadId
        );

        for (const job of runningJobs) {
          log.debug('Cancelling job:', job.id);
          await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
        }
      }

      const thread = await threadStore.getById(threadId);
      if (thread) {
        const updatedMessages = thread.messages.map(message => {
          if (message.role === 'assistant' && hasStreamCursor(message.content)) {
            const content = message.content.replace(' ▊', '').replace('▊', '').trim();
            return {
              ...message,
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

  const hasStreamingMessage = thread.messages.some(
    (message) => message.role === 'assistant' && hasStreamCursor(message.content),
  );
  const isStale =
    nowMs - new Date(thread.updatedAt).getTime() > STALE_STREAM_THRESHOLD_MS;

  if (hasStreamingMessage) {
    if (!isStale) return null;
    return finalizeInterruptedMessage(thread);
  }

  return { ...thread, isStreaming: false, updatedAt: now() };
}
