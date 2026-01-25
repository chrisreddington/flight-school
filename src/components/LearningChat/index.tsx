'use client';

import type { RepoReference, Thread, ThreadContext } from '@/lib/threads/types';
import { CheckIcon, CopilotIcon, PencilIcon, XIcon } from '@primer/octicons-react';
import { Heading, IconButton, Stack, TextInput, Tooltip } from '@primer/react';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ChatInput } from '../ChatInput';
import { MessageBubble } from '../MessageBubble';
import { RepoSelector } from '../RepoSelector';
import type { RepoOption } from '../RepoSelector/types';
import { ThreadSidebar } from '../ThreadSidebar';
import styles from './LearningChat.module.css';

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
  /** Current streaming content */
  streamingContent?: string;
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
 *   streamingContent={streamContent}
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
  userAvatarUrl,
}: LearningChatProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Track pending repos when no thread is active yet
  const [pendingRepos, setPendingRepos] = useState<RepoReference[]>([]);
  // Track inline editing state for thread title
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitle, setEditingTitle] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Get active thread's messages
  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId]
  );

  const messages = activeThread?.messages ?? [];
  // Use pending repos when no thread exists, otherwise use thread repos
  const selectedRepos = activeThread?.context.repos ?? pendingRepos;

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

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
    [activeThreadId, handlers]
  );

  // Handle sending a message with selected repos
  const handleSendMessage = useCallback((message: string) => {
    handlers.sendMessage(message, selectedRepos.length > 0 ? selectedRepos : undefined);
    // Clear pending repos after sending (they'll be saved to thread)
    if (!activeThreadId) {
      setPendingRepos([]);
    }
  }, [handlers, selectedRepos, activeThreadId]);

  // Handle starting title edit
  const handleStartEditTitle = useCallback(() => {
    if (activeThread) {
      setEditingTitle(activeThread.title);
      setIsEditingTitle(true);
      // Focus input after state update
      setTimeout(() => titleInputRef.current?.focus(), 0);
    }
  }, [activeThread]);

  // Handle saving title edit
  const handleSaveTitle = useCallback(() => {
    if (activeThreadId && editingTitle.trim()) {
      handlers.renameThread(activeThreadId, editingTitle.trim());
    }
    setIsEditingTitle(false);
    setEditingTitle('');
  }, [activeThreadId, handlers, editingTitle]);

  // Handle canceling title edit
  const handleCancelEdit = useCallback(() => {
    setIsEditingTitle(false);
    setEditingTitle('');
  }, []);

  // Handle key press in title input
  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveTitle();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  }, [handleSaveTitle, handleCancelEdit]);

  // Detect if active thread is streaming based on thread.isStreaming flag
  // This is set by the background job in storage
  const isStreamingInActiveThread = activeThread?.isStreaming === true;
  
  // All messages come directly from storage - no synthetic messages needed
  // The streaming message has id starting with 'streaming-' and contains cursor ` ▊`
  const displayMessages = messages;

  return (
    <div className={styles.container}>
      {/* Thread Sidebar */}
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

      {/* Main Chat Area */}
      <div className={styles.chatArea}>
        {/* Header */}
        <div className={styles.header}>
          <Stack direction="horizontal" align="center" gap="condensed" className={styles.headerContent}>
            <span className={styles.headerIcon}>
              <CopilotIcon size={20} />
            </span>
            {isEditingTitle ? (
              <Stack direction="horizontal" align="center" gap="condensed" className={styles.titleEditContainer}>
                <TextInput
                  ref={titleInputRef}
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  onBlur={handleSaveTitle}
                  size="small"
                  aria-label="Edit thread title"
                  className={styles.titleInput}
                />
                <Tooltip text="Save" direction="s">
                  <IconButton
                    icon={CheckIcon}
                    aria-label="Save title"
                    variant="invisible"
                    size="small"
                    onClick={handleSaveTitle}
                  />
                </Tooltip>
                <Tooltip text="Cancel" direction="s">
                  <IconButton
                    icon={XIcon}
                    aria-label="Cancel edit"
                    variant="invisible"
                    size="small"
                    onClick={handleCancelEdit}
                  />
                </Tooltip>
              </Stack>
            ) : (
              <Stack direction="horizontal" align="center" gap="condensed">
                <Heading as="h2" className={styles.headerTitle}>
                  {activeThread?.title || 'Learning Chat'}
                </Heading>
                {activeThread && (
                  <Tooltip text="Rename thread" direction="s">
                    <IconButton
                      icon={PencilIcon}
                      aria-label="Rename thread"
                      variant="invisible"
                      size="small"
                      onClick={handleStartEditTitle}
                      className={styles.editButton}
                    />
                  </Tooltip>
                )}
              </Stack>
            )}
          </Stack>
        </div>

        {/* Messages */}
        <div className={styles.messagesContainer}>
          {messages.length === 0 && !isStreamingInActiveThread ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <CopilotIcon size={48} />
              </div>
              <Heading as="h3" className={styles.emptyTitle}>
                Start a learning conversation
              </Heading>
              <p className={styles.emptyDescription}>
                Ask about code concepts, explore repositories, or get help understanding patterns.
                Copilot will explain reasoning and suggest follow-up explorations.
              </p>
            </div>
          ) : (
            <div className={styles.messagesList}>
              {displayMessages.map((message) => {
                // Message is streaming if it has streaming- prefix or contains cursor
                const isMessageStreaming = message.id.startsWith('streaming-') || 
                  (message.role === 'assistant' && message.content.includes(' ▊'));
                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isStreaming={isMessageStreaming}
                    userAvatarUrl={userAvatarUrl}
                  />
                );
              })}
            </div>
          )}
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
