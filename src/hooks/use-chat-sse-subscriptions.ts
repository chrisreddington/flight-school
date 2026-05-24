/**
 * useChatSseSubscriptions Hook
 *
 * Open one SSE subscription per active chat job, dispatching frames to
 * `chatStreamStore` and surfacing a "Reconnecting..." flag after the
 * configured threshold. Extracted from `useLearningChatStream`.
 */

'use client';

import { useEffect, useRef, useState } from 'react';

import { chatStreamStore } from '@/lib/chat/chat-stream-store';
import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import { consumeSSE, SSEReconnectExhaustedError } from '@/lib/streaming/sse-client';

import { buildTerminalHandler, dispatchFrame, type SSEStreamEvent } from './chat-stream-events';

const log = logger.withTag('useLearningChat');

/** Surface a user-visible "Reconnecting..." indicator only after this many
 * consecutive SSE reconnect attempts so brief blips don't flicker. */
const RECONNECT_VISIBLE_AFTER = 3;

/**
 * Subscribe to chat SSE streams keyed by the set of active jobs.
 *
 * @param streamingThreadIdsKey - Sorted comma-joined thread ids that are
 *   currently streaming. Acts as the effect-restart trigger.
 * @param chatSubscriptionKey - Sorted comma-joined `threadId:jobId`
 *   pairs. Distinct from the thread-id key so the effect re-runs when a
 *   new job is registered for an already-streaming thread.
 * @param refreshThreads - Fetch fresh thread snapshot on terminal frames.
 * @returns The set of jobIds currently in a visibly-surfaced reconnect state.
 */
export function useChatSseSubscriptions(
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

        // Defensive register so apply* calls always have a record. For a
        // hydrated job (page reload while a stream is in flight) this is
        // the first opportunity to seed the store with a stable identity.
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
          buildUrl: () => {
            const cursor = getCursor(jobId);
            return `/api/jobs/${encodeURIComponent(jobId)}/stream${cursor > 0 ? `?cursor=${cursor}` : ''}`;
          },
          signal: controller.signal,
          onMessage: (frame) => {
            if (disposed) return { terminal: true };

            // setCursor BEFORE JSON.parse so a mid-parse crash still
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
            // 10-minute reconnect budget exhausted — evict the cursor and
            // surface a terminal "failed" frame so the UI stops showing a
            // typing indicator.
            log.warn('SSE reconnect budget exhausted', { jobId, err: err.message });
            evictCursor(jobId);
            handleTerminal({ type: 'failed', message: err.message });
            markReconnecting(false);
            return;
          }
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
