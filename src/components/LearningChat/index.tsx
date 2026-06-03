'use client';

import type { RepoReference, Thread, ThreadContext } from '@/lib/threads/types';
import { CopilotIcon, PlusIcon } from '@primer/octicons-react';
import { Button, Dialog } from '@primer/react';
import { Blankslate } from '@primer/react/experimental';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { useSmoothedText } from '@/lib/chat/use-smoothed-text';
import { ChatHeader } from './ChatHeader';
import { ChatInput } from '../ChatInput';
import { MessageBubble } from '../MessageBubble';
import { RepoSelector } from '../RepoSelector';
import type { RepoOption } from '../RepoSelector/types';
import { ThreadSidebar } from '../ThreadSidebar';
import { ThreadList } from '../ThreadSidebar/ThreadList';
import styles from './LearningChat.module.css';
import { mergeStreamingMessage } from './streaming-display';
import { useAutoScrollOnNewMessages } from './useAutoScrollOnNewMessages';
import { useThreadTitleEditing } from './useThreadTitleEditing';
import typingStyles from '@/styles/typing-indicator.module.css';

/**
 * Consolidated handlers for chat operations (reduces prop drilling)
 */
interface LearningChatHandlers {
  /** Send a message (with optional repos for context) */
  sendMessage: (message: string, repos?: RepoReference[]) => Promise<void> | void;
  /** Create a new thread */
  createThread: () => void;
  /** Select a thread */
  selectThread: (threadId: string | null) => void;
  /** Delete a thread */
  deleteThread: (threadId: string) => void;
  /** Rename a thread */
  renameThread: (threadId: string, title: string) => void;
  /** Update thread context */
  updateContext: (threadId: string, context: Partial<ThreadContext>) => void;
  /** Stop streaming */
  stopStreaming: () => void;
}

/**
 * Props for the {@link LearningChat} component.
 */
interface LearningChatProps {
  /** All threads */
  threads: Thread[];
  /** Currently active thread ID */
  activeThreadId: string | null;
  /** Consolidated handlers for chat operations */
  handlers: LearningChatHandlers;
  /** Available repositories to select from */
  availableRepos?: RepoOption[];
  /** Whether repos are loading */
  isReposLoading?: boolean;
  /** Whether threads are loading from storage */
  isThreadsLoading?: boolean;
  /** Whether the AI is currently streaming a response (in active thread) */
  isStreaming?: boolean;
  /** IDs of ALL threads that are currently streaming */
  streamingThreadIds?: string[];
  /**
   * Live partial assistant content for the active thread, served from
   * the client `chatStreamStore` (never the durable thread). Empty when
   * nothing is in flight.
   */
  streamingContent?: string;
  /**
   * Stable id of the in-flight assistant message in the active thread,
   * used to identify the streaming `MessageBubble`.
   */
  streamingAssistantMessageId?: string | null;
  /** Tool events emitted by the in-flight chat job. */
  streamingToolEvents?: import('@/lib/threads/types').ToolCallEvent[];
  /** User's avatar URL */
  userAvatarUrl?: string;
}

/**
 * Composite chat component combining sidebar, messages, and input.
 *
 * This is the main learning chat experience, implementing:
 * - Multi-thread sidebar for concurrent conversations (AC1.2)
 * - Message list with smart action indicators (AC3.2)
 * - Learning-focused input with streaming support
 *
 * @example
 * ```tsx
 * <LearningChat
 *   threads={threads}
 *   activeThreadId={currentThreadId}
 *   onSelectThread={setCurrentThreadId}
 *   onNewThread={handleCreateThread}
 *   onDeleteThread={handleDeleteThread}
 *   onSendMessage={handleSend}
 *   isStreaming={isLoading}
 *   userAvatarUrl={user.avatar_url}
 * />
 * ```
 */
export const LearningChat = memo(function LearningChat({
  threads,
  activeThreadId,
  handlers,
  availableRepos = [],
  isReposLoading = false,
  isThreadsLoading = false,
  isStreaming = false,
  streamingThreadIds = [],
  streamingContent = '',
  streamingAssistantMessageId = null,
  streamingToolEvents = [],
  userAvatarUrl,
}: LearningChatProps) {
  // Track pending repos when no thread is active yet
  const [pendingRepos, setPendingRepos] = useState<RepoReference[]>([]);

  // Phone hides the inline sidebar (CSS) and surfaces threads in a drawer;
  // tablet defaults the inline sidebar to its collapsed icon rail so the
  // chat keeps usable width. Desktop shows the full sidebar.
  const isPhone = useMediaQuery('(max-width: 767px)');
  const isTablet = useMediaQuery('(min-width: 768px) and (max-width: 1011px)');
  const [drawerOpen, setDrawerOpen] = useState(false);
  // `null` = follow the breakpoint default; once the user toggles, their
  // choice wins so the breakpoint effect never fights them.
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);
  const sidebarCollapsed = collapsedOverride ?? isTablet;

  // Close the drawer if the viewport grows past phone width, otherwise the
  // overlay could linger alongside the now-visible inline sidebar.
  useEffect(() => {
    if (!isPhone && drawerOpen) {
      setDrawerOpen(false);
    }
  }, [isPhone, drawerOpen]);

  // Get active thread's messages
  const activeThread = useMemo(() => threads.find((t) => t.id === activeThreadId) ?? null, [threads, activeThreadId]);

  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread]);
  // Use pending repos when no thread exists, otherwise use thread repos
  const selectedRepos = activeThread?.context?.repos ?? pendingRepos;

  const titleEditing = useThreadTitleEditing(activeThread, activeThreadId, handlers.renameThread);

  const handleToggleSidebar = useCallback(() => {
    setCollapsedOverride((current) => !(current ?? isTablet));
  }, [isTablet]);

  const handleSelectThreadFromDrawer = useCallback(
    (threadId: string | null) => {
      handlers.selectThread(threadId);
      setDrawerOpen(false);
    },
    [handlers],
  );

  const handleNewThreadFromDrawer = useCallback(() => {
    handlers.createThread();
    setDrawerOpen(false);
  }, [handlers]);

  const handleRepoSelectionChange = useCallback(
    (repos: RepoReference[]) => {
      if (activeThreadId) {
        // Thread exists - update thread context
        handlers.updateContext(activeThreadId, { repos });
      } else {
        // No thread yet - store as pending repos
        setPendingRepos(repos);
      }
    },
    [activeThreadId, handlers],
  );

  // Handle sending a message with selected repos
  const handleSendMessage = useCallback(
    (message: string) => {
      handlers.sendMessage(message, selectedRepos.length > 0 ? selectedRepos : undefined);
      // Clear pending repos after sending (they'll be saved to thread)
      if (!activeThreadId) {
        setPendingRepos([]);
      }
    },
    [handlers, selectedRepos, activeThreadId],
  );

  // Detect if active thread is streaming based on thread.isStreaming flag
  // This is set by the background job in storage
  const isStreamingInActiveThread = isStreaming === true || activeThread?.isStreaming === true;

  // Decouple bursty token arrival from the visible render cadence so
  // chunks feel like smooth typing instead of stuttering blocks. Keyed
  // on assistantMessageId so each new reply starts from empty rather
  // than inheriting the previous response's buffer. Visibility gates
  // still key off raw `streamingContent` — we want the typing indicator
  // to hide the instant tokens land, even if the bubble fills in over
  // the next few frames.
  const smoothedStreamingContent = useSmoothedText(streamingContent, streamingAssistantMessageId);

  const displayMessages = useMemo(
    () =>
      mergeStreamingMessage(messages, {
        isStreaming: isStreamingInActiveThread,
        assistantMessageId: streamingAssistantMessageId,
        rawContent: streamingContent,
        smoothedContent: smoothedStreamingContent,
        toolEvents: streamingToolEvents,
      }),
    [
      messages,
      isStreamingInActiveThread,
      streamingAssistantMessageId,
      streamingContent,
      smoothedStreamingContent,
      streamingToolEvents,
    ],
  );
  // Show typing indicator when streaming starts but no streaming content has arrived yet.
  const hasStreamingMessage = Boolean(streamingAssistantMessageId) && Boolean(streamingContent);
  const showTypingIndicator = isStreamingInActiveThread && !hasStreamingMessage;

  const messagesEndRef = useAutoScrollOnNewMessages({
    activeThreadId,
    messageCount: displayMessages.length,
    showTypingIndicator,
  });

  return (
    <div className={styles.container}>
      {/* Inline thread sidebar (hidden on phone via CSS; threads move to a drawer). */}
      <div className={styles.inlineSidebar}>
        <ThreadSidebar
          threads={threads}
          activeThreadId={activeThreadId}
          streamingThreadIds={streamingThreadIds}
          isLoading={isThreadsLoading}
          onSelectThread={handlers.selectThread}
          onNewThread={handlers.createThread}
          onDeleteThread={handlers.deleteThread}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebar}
        />
      </div>

      {/* Conversations drawer (phone only). */}
      {drawerOpen && (
        <Dialog title="Conversations" position={{ narrow: 'left' }} width="small" onClose={() => setDrawerOpen(false)}>
          <div className={styles.drawerActions}>
            <Button variant="primary" leadingVisual={PlusIcon} block onClick={handleNewThreadFromDrawer}>
              New conversation
            </Button>
          </div>
          <ThreadList
            threads={threads}
            activeThreadId={activeThreadId}
            streamingThreadIds={streamingThreadIds}
            isLoading={isThreadsLoading}
            onSelectThread={handleSelectThreadFromDrawer}
            onNewThread={handleNewThreadFromDrawer}
            onDeleteThread={handlers.deleteThread}
          />
        </Dialog>
      )}

      {/* Main Chat Area */}
      <div className={styles.chatArea}>
        <ChatHeader
          activeThread={activeThread}
          titleEditing={titleEditing}
          onOpenThreads={() => setDrawerOpen(true)}
          isThreadsOpen={drawerOpen}
        />

        {/* Messages */}
        <div className={styles.messagesContainer} role="log" aria-label="Chat messages">
          {messages.length === 0 && !isStreamingInActiveThread ? (
            <div className={styles.emptyState}>
              <Blankslate spacious narrow>
                <Blankslate.Visual>
                  <CopilotIcon size={48} />
                </Blankslate.Visual>
                <Blankslate.Heading>Start a learning conversation</Blankslate.Heading>
                <Blankslate.Description>
                  Ask about code concepts, explore repositories, or get help understanding patterns. Copilot will
                  explain reasoning and suggest follow-up explorations.
                </Blankslate.Description>
              </Blankslate>
            </div>
          ) : (
            <div className={styles.messagesList}>
              {displayMessages.map((message) => {
                // A message is rendered as streaming when its id matches
                // the live `streamingAssistantMessageId` surfaced by the
                // chat-stream store.
                const isMessageStreaming =
                  message.role === 'assistant' &&
                  streamingAssistantMessageId !== null &&
                  message.id === streamingAssistantMessageId;
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isMessageStreaming}
                    userAvatarUrl={userAvatarUrl}
                    onFollowUpSelect={handleSendMessage}
                  />
                );
              })}
            </div>
          )}

          {showTypingIndicator && (
            <div
              className={`${typingStyles.typingIndicator} ${styles.typingIndicatorOffset}`}
              aria-label="Copilot is thinking"
              role="status"
            >
              <span className={typingStyles.typingDot} />
              <span className={typingStyles.typingDot} />
              <span className={typingStyles.typingDot} />
            </div>
          )}

          {/* Scroll sentinel - auto-scrolled to when messages update */}
          <div ref={messagesEndRef} />

          {/* Screen reader announcements for streaming status */}
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {isStreamingInActiveThread && 'Copilot is responding...'}
          </div>
        </div>

        {/* Input Area - Single Row: Context Selector | Input | Button */}
        <div className={styles.inputArea}>
          <RepoSelector
            selectedRepos={selectedRepos}
            onSelectionChange={handleRepoSelectionChange}
            availableRepos={availableRepos}
            isLoading={isReposLoading}
            placeholder="Search repos..."
            disabled={isStreaming}
            inline
          />
          <div className={styles.inputWrapper}>
            <ChatInput
              onSend={handleSendMessage}
              disabled={isStreaming}
              placeholder="Ask a question, explore a concept..."
              isStreaming={isStreaming}
              onStop={handlers.stopStreaming}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
