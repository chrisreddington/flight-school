'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { chatStreamStore, TERMINAL_SEQ, type ChatStreamState } from '@/lib/chat/chat-stream-store';
import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import { consumeSSE, SSEReconnectExhaustedError } from '@/lib/streaming/sse-client';
import type { ToolCallEvent } from '@/lib/threads';
import { THREAD_DATA_CHANGED_EVENT, threadStore, type Thread } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';

/**
 * Wire-format mirror of the worker-side `JobStreamEvent` discriminated
 * union. Kept inline here so the client hook does not have to import
 * across the `@/worker/jobs/streaming/*` architecture boundary
 * (enforced by `worker-job-boundaries.test.ts`). Shape must stay in
 * sync with `src/worker/jobs/streaming/types.ts`.
 */
type SSEStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_start'; toolCallId: string; name: string; args: unknown }
  | { type: 'tool_complete'; toolCallId: string; name: string; result: unknown; durationMs: number }
  | { type: 'state_snapshot'; content: string; toolEvents: ToolCallEvent[]; hasActionableItem: boolean }
  | { type: 'done'; content: string; toolEvents: ToolCallEvent[]; hasActionableItem: boolean }
  | { type: 'cancelled'; content: string; toolEvents: ToolCallEvent[] }
  | { type: 'failed'; message: string };

const log = logger.withTag('useLearningChat');

/**
 * Wall-clock budget after which a thread still marked
 * `isStreaming: true` in storage, but with NO matching live chat
 * operation in `operationsManager`, is considered abandoned. The
 * stale-stream effect rewrites it to `isStreaming: false` so the UI
 * stops perpetually showing a typing indicator after a worker crash
 * (the worker would have annotated the thread itself if it had a
 * chance — sweep handles the durable annotation).
 */
const STALE_STREAM_THRESHOLD_MS = 5_000;

/** Surface a user-visible "Reconnecting..." indicator only after this many
 * consecutive SSE reconnect attempts so brief blips don't flicker. */
const RECONNECT_VISIBLE_AFTER = 3;

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

/**
 * Read the in-flight assistant content for the given thread from the
 * client-side chat-stream store. The worker does not write mid-stream
 * content into the durable thread, so this store — not
 * `Thread.messages` — is the canonical source for any partial
 * assistant message that is still streaming.
 *
 * Returns the empty string when no live record exists.
 */
export function getStreamingContentForThread(
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

/**
 * Apply a terminal SSE frame (done/cancelled) to the chat-stream store at
 * the terminal sentinel seq, then refresh durable threads. The refresh
 * must succeed before we evict the live record and complete the op so a
 * transient refresh failure leaves the UI showing the last visible state
 * (and a subsequent terminal replay can retry).
 */
function buildTerminalHandler(
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
        log.warn(
          'refreshThreads failed during terminal cleanup; leaving live record in place for retry',
          { jobId, err },
        );
        terminalCleanupsRef.current.delete(jobId);
      });
  };
}

/**
 * Translate a parsed SSE frame into the corresponding `chatStreamStore`
 * mutation, or invoke the terminal handler for done/cancelled/failed.
 * Returns `true` when the frame was terminal (caller should close the
 * subscription).
 */
function dispatchFrame(
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

/**
 * Open one SSE subscription per active chat job, dispatching frames to
 * `chatStreamStore` and surfacing a "Reconnecting..." flag after the
 * configured threshold. Returns the set of jobIds currently in a visibly
 * surfaced reconnect state.
 */
function useSseSubscriptions(
  streamingThreadIdsKey: string,
  chatSubscriptionKey: string,
  refreshThreads: () => Promise<void>,
): ReadonlySet<string> {
  const terminalCleanupsRef = useRef<Set<string>>(new Set());
  const [reconnectingJobIds, setReconnectingJobIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  useEffect(() => {
    const ids = streamingThreadIdsKey ? streamingThreadIdsKey.split(',') : [];
    if (ids.length === 0) return;
    if (!chatSubscriptionKey) return;

    log.debug('Subscribing to SSE streams', { count: ids.length });
    const controllers: AbortController[] = [];
    let disposed = false;

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
        const assistantMessageId = op.meta.assistantMessageId;
        if (!jobId || !threadId) continue;
        if (!idSet.has(threadId)) continue;
        if (subscribedJobIds.has(jobId)) continue;
        subscribedJobIds.add(jobId);

        // Defensive register so apply* calls always have a record. The
        // sender (`useLearningChat.sendMessage`) registers synchronously
        // after `apiPost` returns, but for a hydrated job (page reload
        // while a stream is in flight) this is the first opportunity to
        // seed the store with a stable identity.
        chatStreamStore.register(jobId, threadId, assistantMessageId ?? '');

        const handleTerminal = buildTerminalHandler(jobId, terminalCleanupsRef, refreshThreads);

        const markReconnecting = (visible: boolean): void => {
          if (disposed) return;
          setReconnectingJobIds((prev) => {
            const has = prev.has(jobId);
            if (visible === has) return prev;
            const next = new Set(prev);
            if (visible) next.add(jobId);
            else next.delete(jobId);
            return next;
          });
        };

        const controller = new AbortController();
        controllers.push(controller);

        void consumeSSE({
          // Recompute on every (re)connect so the latest cursor is
          // always used — never a stale closure-captured value.
          buildUrl: () => {
            const cursor = getCursor(jobId);
            return `/api/jobs/${encodeURIComponent(jobId)}/stream${cursor > 0 ? `?cursor=${cursor}` : ''}`;
          },
          signal: controller.signal,
          onMessage: (frame) => {
            if (disposed) return { terminal: true };

            // setCursor BEFORE JSON parse so a mid-parse crash still
            // bumps the durable last-seen seq.
            let seq = 0;
            if (frame.id) {
              const parsed = Number.parseInt(frame.id, 10);
              if (Number.isFinite(parsed)) {
                seq = parsed;
                setCursor(jobId, parsed);
              }
            }

            if (frame.data === '[DONE]') {
              evictCursor(jobId);
              handleTerminal();
              return { terminal: true };
            }

            let parsed: SSEStreamEvent | null = null;
            try {
              parsed = JSON.parse(frame.data) as SSEStreamEvent;
            } catch (err) {
              log.warn('Failed to parse SSE frame', { jobId, err });
              return;
            }
            if (!parsed) return;

            const wasTerminal = dispatchFrame(jobId, parsed, seq, handleTerminal);
            return wasTerminal ? { terminal: true } : undefined;
          },
          onReconnectScheduled: (attempt) => {
            if (attempt >= RECONNECT_VISIBLE_AFTER) {
              markReconnecting(true);
            }
          },
          onReconnectRecovered: () => {
            markReconnecting(false);
          },
        }).catch((err: unknown) => {
          if (err instanceof SSEReconnectExhaustedError) {
            // 10-minute reconnect budget exhausted — evict the cursor
            // and surface a terminal "failed" frame to the store so
            // the UI stops showing a typing indicator.
            log.warn('SSE reconnect budget exhausted', { jobId, err: err.message });
            evictCursor(jobId);
            handleTerminal({ type: 'failed', message: err.message });
            markReconnecting(false);
            return;
          }
          // Aborts return silently from consumeSSE; anything else
          // reaching here is unexpected.
          log.warn('Chat SSE consumer terminated unexpectedly', { jobId, err });
          markReconnecting(false);
        });
      }
    })();

    return () => {
      disposed = true;
      log.debug('Closing SSE subscriptions', { count: controllers.length });
      for (const controller of controllers) controller.abort();
    };
  }, [streamingThreadIdsKey, chatSubscriptionKey, refreshThreads]);

  return reconnectingJobIds;
}

/**
 * Reconcile the in-memory `pendingStreamMessages` map against durable
 * threads: a thread leaves the pending set once it is no longer marked
 * `isStreaming` AND has an assistant message after the user's send.
 */
function usePendingStreamReconciler(
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

/**
 * Client-side safety net: any thread with `isStreaming: true` that has
 * NO live chat op (after operationsManager has hydrated) and has been
 * idle past `STALE_STREAM_THRESHOLD_MS` is considered orphaned (worker
 * crash, etc.) and rewritten to `isStreaming: false` so the UI stops
 * perpetually showing a typing indicator. Worker/sweep own the durable
 * annotation; this is only the client view.
 */
function useStaleStreamFinalizer(
  isThreadsLoading: boolean,
  threads: Thread[],
  pendingStreamMessages: PendingStreamMessages,
  opsSnapshot: ReturnType<typeof operationsManager.getSnapshot>,
): void {
  useEffect(() => {
    if (isThreadsLoading || threads.length === 0) return;
    if (!opsSnapshot.hydrated) return;

    const liveThreadIds = new Set<string>();
    for (const op of opsSnapshot.chatMessages.values()) {
      const threadId = op.meta.targetId;
      if (threadId) liveThreadIds.add(threadId);
    }

    const nowMs = Date.now();
    const updates: Thread[] = [];
    for (const thread of threads) {
      if (!thread.isStreaming) continue;
      if (liveThreadIds.has(thread.id)) continue;
      if (pendingStreamMessages.has(thread.id)) continue;
      const ageMs = nowMs - new Date(thread.updatedAt).getTime();
      if (ageMs <= STALE_STREAM_THRESHOLD_MS) continue;
      updates.push({ ...thread, isStreaming: false, updatedAt: now() });
    }

    if (updates.length === 0) return;
    void Promise.all(updates.map((thread) => threadStore.update(thread)));
  }, [isThreadsLoading, threads, pendingStreamMessages, opsSnapshot]);
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

  // Subscribe to the chat-stream store so any delta/snapshot from the
  // SSE handler triggers a re-render with the latest live content for
  // the active thread.
  const streamRecords = useSyncExternalStore(
    chatStreamStore.subscribe.bind(chatStreamStore),
    () => chatStreamStore.getSnapshot(),
    () => chatStreamStore.getSnapshot(),
  );
  const { content: streamingContent, assistantMessageId: streamingAssistantMessageId, toolEvents: streamingToolEvents } =
    useMemo(
      () => getStreamingContentForThread(streamRecords, activeThreadId),
      [streamRecords, activeThreadId],
    );

  // Ensure operationsManager has had a chance to hydrate from the
  // server-side job list on page load.
  useEffect(() => {
    void operationsManager.initialize();
  }, []);

  // Subscribe to operationsManager so the SSE-attach effect re-runs when
  // a new chat job is registered via `registerExistingJob` AFTER this
  // hook has already observed the corresponding streaming thread id.
  const opsSnapshot = useSyncExternalStore(
    operationsManager.subscribe.bind(operationsManager),
    () => operationsManager.getSnapshot(),
    () => operationsManager.getSnapshot(),
  );

  // Active chat operations are the PRIMARY signal that a thread is
  // streaming. `thread.isStreaming` is a fallback for the brief window
  // between user-send and op registration; `pendingStreamMessages`
  // covers the period before storage has caught up. Cold-tab reloads
  // land here with chat ops hydrated from the job list — without them
  // in this set the SSE effect would never attach.
  const opStreamingThreadIds = useMemo(() => {
    const out: string[] = [];
    for (const op of opsSnapshot.chatMessages.values()) {
      const threadId = op.meta.targetId;
      if (threadId) out.push(threadId);
    }
    return out;
  }, [opsSnapshot]);

  const allStreamingThreadIds = useMemo(
    () => Array.from(new Set([
      ...opStreamingThreadIds,
      ...storageStreamingThreadIds,
      ...pendingStreamMessages.keys(),
    ])),
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

  const reconnectingJobIds = useSseSubscriptions(
    streamingThreadIdsKey,
    chatSubscriptionKey,
    refreshThreads,
  );
  usePendingStreamReconciler(pendingStreamMessages, setPendingStreamMessages, threads);
  useStaleStreamFinalizer(isThreadsLoading, threads, pendingStreamMessages, opsSnapshot);

  // Auto-select the most recently streaming thread on load when nothing
  // is selected — gives a useful default after page refresh.
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
    setPendingStreamMessages(prev => new Map([...prev, [threadId, userMessageId]]));
  }, []);

  const clearPendingStream = useCallback((threadId: string) => {
    setPendingStreamMessages(prev => {
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
    // `*(Response stopped)*` annotation into the durable thread as
    // part of its terminal sequence. Writing here would double-tag.
    try {
      const jobsRes = await fetch('/api/jobs');
      if (jobsRes.ok) {
        const { jobs } = await jobsRes.json();
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

