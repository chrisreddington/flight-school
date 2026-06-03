'use client';

import type { Thread } from '@/lib/threads/types';
import { PlusIcon, SidebarCollapseIcon, SidebarExpandIcon } from '@primer/octicons-react';
import { IconButton, Stack, Tooltip } from '@primer/react';
import { memo } from 'react';
import { ThreadList } from './ThreadList';
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
  /** Whether threads are loading from storage */
  isLoading?: boolean;
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
  isLoading = false,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  collapsed = false,
  onToggleCollapsed,
}: ThreadSidebarProps) {
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
            <IconButton icon={PlusIcon} aria-label="New thread" variant="invisible" onClick={onNewThread} />
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
        <ThreadList
          threads={threads}
          activeThreadId={activeThreadId}
          streamingThreadIds={streamingThreadIds}
          isLoading={isLoading}
          onSelectThread={onSelectThread}
          onNewThread={onNewThread}
          onDeleteThread={onDeleteThread}
        />
      </Stack>
    </aside>
  );
});
