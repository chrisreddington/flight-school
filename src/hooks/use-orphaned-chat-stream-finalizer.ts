/**
 * useOrphanedChatStreamFinalizer Hook
 *
 * Client-side safety net: any thread with `isStreaming: true` that has
 * NO live chat op (after operationsManager has hydrated) and has been
 * idle past `STALE_STREAM_THRESHOLD_MS` is considered orphaned (worker
 * crash, etc.) and rewritten to `isStreaming: false` so the UI stops
 * perpetually showing a typing indicator.
 *
 * Worker/sweep own the durable annotation; this is only the client view.
 */

'use client';

import { useEffect } from 'react';

import type { operationsManager } from '@/lib/operations';
import { threadStore, type Thread } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';

import type { PendingStreamMessages } from './use-pending-stream-reconciler';

/**
 * Wall-clock budget after which an orphaned streaming thread is
 * considered dead and rewritten to `isStreaming: false`.
 */
const STALE_STREAM_THRESHOLD_MS = 5_000;

export function useOrphanedChatStreamFinalizer(
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
