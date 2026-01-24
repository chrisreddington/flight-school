'use client';

import type { Thread } from '@/lib/threads/types';
import { PlusIcon, SidebarCollapseIcon, SidebarExpandIcon, TrashIcon } from '@primer/octicons-react';
import { ActionList, Button, IconButton, RelativeTime, Spinner, Stack, Tooltip, Truncate } from '@primer/react';
import type React from 'react';
import { memo, useMemo } from 'react';
import styles from './ThreadSidebar.module.css';

/**
 * Props for the {@link ThreadSidebar} component.
 */
interface ThreadSidebarProps {
  /** List of all threads to display */
  threads: Thread[];
  /** Currently active thread ID (or null for new conversation) */
  activeThreadId: string | null;
  /** IDs of threads that are currently streaming */
  streamingThreadIds?: string[];
  /** Callback when a thread is selected */
  onSelectThread: (threadId: string | null) => void;
  /** Callback to create a new thread */
  onNewThread: () => void;
  /** Callback to delete a thread */
  onDeleteThread: (threadId: string) => void;
  /** Whether the sidebar is collapsed */
  collapsed?: boolean;
  /** Callback to toggle collapsed state */
  onToggleCollapsed?: () => void;
}

/**
 * Sidebar component for managing learning chat threads.
 * 
 * Displays a list of threads with options to create new ones,
 * select existing threads, and delete threads.
 * 
 * PERF: Memoized to prevent re-renders when parent state changes.
 * Only re-renders when threads, activeThreadId, or streamingThreadIds change.
 * 
 * @example
 * ```tsx
 * <ThreadSidebar
 *   threads={threads}
 *   activeThreadId={currentId}
 *   onSelectThread={setCurrentId}
 *   onNewThread={handleNew}
 *   onDeleteThread={handleDelete}
 * />
 * ```
 */
export const ThreadSidebar = memo(function ThreadSidebar({
  threads,
  activeThreadId,
  streamingThreadIds = [],
  onSelectThread,
  onNewThread,
  onDeleteThread,
  collapsed = false,
  onToggleCollapsed,
}: ThreadSidebarProps) {
  // Sort threads by updatedAt (most recent first)
  const sortedThreads = useMemo(() => 
    [...threads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [threads]
  );

  const handleDeleteClick = (e: React.MouseEvent | React.KeyboardEvent, threadId: string) => {
    e.stopPropagation();
    onDeleteThread(threadId);
  };

  if (collapsed) {
    return (
      <aside className={styles.sidebarCollapsed} aria-label="Thread navigation (collapsed)">
        <Stack direction="vertical" gap="condensed" padding="condensed">
          {onToggleCollapsed && (
            <Tooltip text="Expand sidebar" direction="e">
              <IconButton
                icon={SidebarCollapseIcon}
                aria-label="Expand sidebar"
                variant="invisible"
                onClick={onToggleCollapsed}
              />
            </Tooltip>
          )}
          <Tooltip text="New thread" direction="e">
            <IconButton
              icon={PlusIcon}
              aria-label="New thread"
              variant="invisible"
              onClick={onNewThread}
            />
          </Tooltip>
        </Stack>
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar} aria-label="Thread navigation">
      <Stack direction="vertical" gap="none" className={styles.sidebarInner}>
        {/* Header */}
        <div className={styles.header}>
          <Stack direction="horizontal" align="center" justify="space-between" padding="condensed">
            <span className={styles.headerTitle}>Conversations</span>
            <Stack direction="horizontal" gap="condensed">
              <Tooltip text="New thread" direction="s">
                <IconButton
                  icon={PlusIcon}
                  aria-label="New thread"
                  variant="invisible"
                  size="small"
                  onClick={onNewThread}
                />
              </Tooltip>
              {onToggleCollapsed && (
                <Tooltip text="Collapse sidebar" direction="s">
                  <IconButton
                    icon={SidebarExpandIcon}
                    aria-label="Collapse sidebar"
                    variant="invisible"
                    size="small"
                    onClick={onToggleCollapsed}
                  />
                </Tooltip>
              )}
            </Stack>
          </Stack>
        </div>

        {/* Thread List */}
        <div className={styles.threadList}>
          {sortedThreads.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyStateText}>No conversations yet</p>
              <Button
                variant="primary"
                size="small"
                leadingVisual={PlusIcon}
                onClick={onNewThread}
              >
                Start a conversation
              </Button>
            </div>
          ) : (
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
                        {isStreaming && (
                          <Spinner size="small" />
                        )}
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
          )}
        </div>
      </Stack>
    </aside>
  );
});

