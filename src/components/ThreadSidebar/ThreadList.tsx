'use client';

import type { Thread } from '@/lib/threads/types';
import { PlusIcon, TrashIcon } from '@primer/octicons-react';
import { ActionList, Button, RelativeTime, Spinner, Stack, Truncate } from '@primer/react';
import type React from 'react';
import { memo, useMemo } from 'react';
import styles from './ThreadSidebar.module.css';

/**
 * Props for the {@link ThreadList} component.
 */
interface ThreadListProps {
  /** Threads to display; sorted most-recent-first internally. */
  threads: Thread[];
  /** Currently active thread ID (or null for a new conversation). */
  activeThreadId: string | null;
  /** IDs of threads that are currently streaming. */
  streamingThreadIds?: string[];
  /** Whether threads are still loading from storage. */
  isLoading?: boolean;
  /** Callback when a thread is selected. */
  onSelectThread: (threadId: string | null) => void;
  /** Callback to create a new thread. */
  onNewThread: () => void;
  /** Callback to delete a thread. */
  onDeleteThread: (threadId: string) => void;
}

/**
 * Scrollable list of chat threads with loading and empty states.
 *
 * Presentational only: it owns the recency sort and row rendering so the
 * same list can back both the inline {@link ThreadSidebar} on wider
 * viewports and the conversations drawer on phones.
 */
export const ThreadList = memo(function ThreadList({
  threads,
  activeThreadId,
  streamingThreadIds = [],
  isLoading = false,
  onSelectThread,
  onNewThread,
  onDeleteThread,
}: ThreadListProps) {
  const sortedThreads = useMemo(
    () => [...threads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [threads],
  );

  const handleDeleteClick = (e: React.MouseEvent | React.KeyboardEvent, threadId: string) => {
    e.stopPropagation();
    onDeleteThread(threadId);
  };

  if (isLoading) {
    return (
      <div className={styles.threadList}>
        <div className={styles.emptyState}>
          <Spinner size="medium" />
          <p className={styles.emptyStateText}>Loading conversations...</p>
        </div>
      </div>
    );
  }

  if (sortedThreads.length === 0) {
    return (
      <div className={styles.threadList}>
        <div className={styles.emptyState}>
          <p className={styles.emptyStateText}>No conversations yet</p>
          <Button variant="primary" size="small" leadingVisual={PlusIcon} onClick={onNewThread}>
            Start a conversation
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.threadList}>
      <ActionList aria-label="Thread list">
        {sortedThreads.map((thread) => {
          const isStreaming = streamingThreadIds.includes(thread.id);
          return (
            <ActionList.Item
              key={thread.id}
              active={thread.id === activeThreadId}
              onSelect={() => onSelectThread(thread.id)}
              as="div"
            >
              <Stack direction="vertical" gap="none">
                <Stack direction="horizontal" align="center" gap="condensed">
                  <Truncate title={thread.title} inline maxWidth={isStreaming ? 150 : 180}>
                    {thread.title}
                  </Truncate>
                  {isStreaming && <Spinner size="small" />}
                </Stack>
                <span className={styles.threadMeta}>
                  <RelativeTime date={new Date(thread.updatedAt)} />
                  {' · '}
                  {thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
                </span>
              </Stack>
              <ActionList.TrailingAction
                icon={TrashIcon}
                label="Delete"
                aria-label={`Delete thread: ${thread.title}`}
                onClick={(e: React.MouseEvent | React.KeyboardEvent) => handleDeleteClick(e, thread.id)}
              />
            </ActionList.Item>
          );
        })}
      </ActionList>
    </div>
  );
});
