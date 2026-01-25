/**
 * useLearningChat Hook
 *
 * Composite hook combining thread management (useThreads) with Copilot streaming
 * (useCopilotStream) to provide a complete multi-thread learning chat experience.
 *
 * This hook orchestrates:
 * - Thread CRUD operations (create, select, delete, rename)
 * - Message persistence to threads
 * - Streaming responses with automatic thread syncing
 * - Learning mode with repo context support
 *
 * @example
 * ```typescript
 * const {
 *   threads,
 *   activeThread,
 *   isLoading,
 *   streamingContent,
 *   sendMessage,
 *   createThread,
 *   selectThread,
 *   deleteThread,
 * } = useLearningChat();
 *
 * // Send a message (automatically saves to active thread)
 * await sendMessage('How do React hooks work?');
 *
 * // Create a new thread
 * createThread({ title: 'Learning TypeScript' });
 * ```
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import { operationsManager } from '@/lib/operations';
import type { StreamState } from '@/lib/stream-store/types';
import type { Message, RepoReference, Thread } from '@/lib/threads';
import { threadStore } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useCopilotStream } from './use-copilot-stream';
import { useThreads, type UseThreadsReturn } from './use-threads';

const log = logger.withTag('useLearningChat');
const STREAMING_PARTIAL_APPEND_MS = 1500;
/** Interval for polling thread updates when a background job is active */
const BACKGROUND_JOB_POLL_INTERVAL_MS = 500;

/** Event name for thread data changes (from background jobs) */
const THREAD_DATA_CHANGED = 'thread-data-changed';

// ============================================================================
// Types
// ============================================================================

/** Options for sending a learning chat message */
export interface SendLearningMessageOptions {
  /** Enable GitHub MCP tools for repo exploration */
  useGitHubTools?: boolean;
  /** Override repos (defaults to active thread's repos) */
  repos?: RepoReference[];
  /** Explicit thread ID to send to (avoids race condition with async state updates) */
  threadId?: string;
}

/** State returned by the useLearningChat hook */
interface UseLearningChatState {
  /** All threads */
  threads: UseThreadsReturn['threads'];
  /** Currently active thread */
  activeThread: UseThreadsReturn['activeThread'];
  /** Active thread ID */
  activeThreadId: UseThreadsReturn['activeThreadId'];
  /** Whether threads are loading from storage */
  isThreadsLoading: UseThreadsReturn['isLoading'];
  /** Whether a message is being processed (in the active thread) */
  isStreaming: boolean;
  /** Current streaming content (partial response) for active thread */
  streamingContent: string;
  /** ID of the thread that is currently streaming (last one started, for backward compatibility) */
  streamingThreadId: string | null;
  /** IDs of ALL threads that are currently streaming */
  streamingThreadIds: string[];
}

/** Actions provided by the useLearningChat hook */
interface UseLearningChatActions {
  /** Send a message to the active thread */
  sendMessage: (content: string, options?: SendLearningMessageOptions) => Promise<void>;
  /** Stop the current streaming response */
  stopStreaming: () => void;
  /** Create a new thread */
  createThread: UseThreadsReturn['createThread'];
  /** Select a thread by ID */
  selectThread: UseThreadsReturn['selectThread'];
  /** Delete a thread by ID */
  deleteThread: UseThreadsReturn['deleteThread'];
  /** Rename a thread */
  renameThread: UseThreadsReturn['renameThread'];
  /** Update thread context (repos, learning focus) */
  updateContext: UseThreadsReturn['updateContext'];
}

/** Return type of the useLearningChat hook */
export type UseLearningChatReturn = UseLearningChatState & UseLearningChatActions;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a completed StreamState to a thread Message.
 * Used by onComplete callback which runs outside React lifecycle.
 *
 * @param state - The completed stream state
 * @returns A thread-compatible message, or null if state is error/empty
 */
function streamStateToThreadMessage(state: StreamState): Message | null {
  // Use streamingBuffer if content is empty (handles interrupted streams)
  const rawContent = state.content || state.streamingBuffer || '';
  
  // Don't create a message for errors without content
  if (state.status === 'error' && !rawContent) {
    return null;
  }
  
  // Build content - add indicators for non-completed streams
  let content = rawContent;
  if (state.status === 'aborted' && content) {
    content += '\n\n*(Response stopped)*';
  } else if (state.status === 'error' && content) {
    content += '\n\n*(Response interrupted)*';
  } else if (state.wasInterrupted && content) {
    content += '\n\n*(Response interrupted)*';
  }
  
  // Don't create empty messages
  if (!content) {
    return null;
  }
  
  return {
    id: generateMessageId(),
    role: 'assistant',
    content,
    timestamp: now(),
    toolCalls: state.toolCalls?.map((tc) => tc.name),
    hasActionableItem: state.hasActionableItem,
    perf: {
      clientTotalMs: state.completedAt && state.startedAt
        ? Math.round(state.completedAt - state.startedAt)
        : undefined,
      clientFirstTokenMs: state.clientFirstTokenMs,
      serverTotalMs: state.serverMeta?.totalMs,
      sessionPoolHit: state.serverMeta?.sessionPoolHit ?? undefined,
      mcpEnabled: state.serverMeta?.mcpEnabled ?? undefined,
      sessionReused: state.serverMeta?.sessionReused ?? undefined,
    },
  };
}

/**
 * Adds or updates a partial streaming message for the thread.
 */
function upsertStreamingMessage(
  thread: Thread,
  content: string,
  toolCalls: StreamState['toolCalls'],
  hasActionableItem?: boolean,
  isInterrupted?: boolean
): Thread {
  const messageSuffix = isInterrupted ? '\n\n*(Response interrupted)*' : '';
  const messageContent = `${content}${messageSuffix}`;
  const existingIndex = thread.messages.findIndex((message) => message.id === 'streaming');

  const streamingMessage: Message = {
    id: 'streaming',
    role: 'assistant',
    content: messageContent,
    timestamp: now(),
    toolCalls: toolCalls?.map((tc) => tc.name),
    hasActionableItem,
  };

  if (existingIndex >= 0) {
    const updatedMessages = [...thread.messages];
    updatedMessages[existingIndex] = streamingMessage;
    return { ...thread, messages: updatedMessages, updatedAt: now() };
  }

  return {
    ...thread,
    messages: [...thread.messages, streamingMessage],
    updatedAt: now(),
  };
}

/**
 * Removes the partial streaming message from a thread.
 */
function removeStreamingMessage(thread: Thread): Thread {
  const filteredMessages = thread.messages.filter((message) => message.id !== 'streaming');
  if (filteredMessages.length === thread.messages.length) {
    return thread;
  }
  return { ...thread, messages: filteredMessages, updatedAt: now() };
}

/**
 * Converts a stored streaming message into a completed, interrupted message.
 */
function finalizeInterruptedMessage(thread: Thread): Thread | null {
  const streamingMessage = thread.messages.find((message) => message.id === 'streaming');
  if (!streamingMessage) return null;

  const trimmedContent = streamingMessage.content.trim();
  if (!trimmedContent) {
    return removeStreamingMessage(thread);
  }

  const interruptionNote = '*(Response interrupted)*';
  const content = streamingMessage.content.includes(interruptionNote)
    ? streamingMessage.content
    : `${streamingMessage.content}\n\n${interruptionNote}`;

  const finalizedMessage: Message = {
    ...streamingMessage,
    id: generateMessageId(),
    content,
    timestamp: now(),
  };

  const withoutStreaming = thread.messages.filter((message) => message.id !== 'streaming');
  return {
    ...thread,
    messages: [...withoutStreaming, finalizedMessage],
    updatedAt: now(),
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Composite hook for multi-thread learning chat.
 *
 * Combines thread management with Copilot streaming to provide:
 * - Automatic message persistence to threads
 * - Thread-scoped conversation context
 * - Real-time streaming with thread syncing
 * - Learning-focused interactions
 * - **Multiple concurrent streams** across different threads
 *
 * @returns Combined thread state, streaming state, and actions
 */
export function useLearningChat(): UseLearningChatReturn {
  // Thread management
  const {
    threads,
    activeThread,
    activeThreadId,
    isLoading: isThreadsLoading,
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    updateContext,
    updateActiveThread,
    refresh: refreshThreads,
  } = useThreads();

  // Streaming - now supports multiple concurrent streams via per-conversation tracking
  const {
    isLoading: anyStreaming,
    streamingContent: defaultStreamingContent,
    sendMessage: sendStreamingMessage,
    stopStreaming: stopStreamingBase,
    isStreamingConversation,
    getStreamingContent,
    activeStreams,
  } = useCopilotStream();

  // Track if there's an active background chat job for the current thread.
  // This is separate from SSE streaming - it runs server-side.
  const [hasActiveBackgroundJob, setHasActiveBackgroundJob] = useState(false);
  const [backgroundJobContent, setBackgroundJobContent] = useState<string>('');
  const backgroundPollRef = useRef<NodeJS.Timeout | null>(null);
  const lastMessageCountRef = useRef<number>(0);

  // Get ALL streaming thread IDs for sidebar indicators
  const streamingThreadIds = Array.from(activeStreams.keys());
  
  // For backward compatibility, expose a single streamingThreadId (most recently started)
  const streamingThreadId = streamingThreadIds[streamingThreadIds.length - 1] ?? null;
  
  // Get streaming content for the active thread specifically
  // Prefer SSE content, fall back to background job content
  const streamingContent = activeThreadId 
    ? (getStreamingContent(activeThreadId) || backgroundJobContent)
    : defaultStreamingContent;
  
  // For "isStreaming", include both SSE streaming AND background job streaming
  // This gives proper UX - shows loading when either is active
  const sseStreaming = activeThreadId ? isStreamingConversation(activeThreadId) : anyStreaming;
  const isStreaming = sseStreaming || hasActiveBackgroundJob;

  // Check for active background job and start polling when thread changes
  // NOTE: setState calls are necessary here to sync with background job state.
  // This is a one-time sync when thread changes, not a cascading render issue.
  useEffect(() => {
    const updateBackgroundJobState = (hasJob: boolean) => {
      queueMicrotask(() => {
        setHasActiveBackgroundJob(hasJob);
        if (!hasJob) {
          setBackgroundJobContent('');
        }
      });
    };

    const clearBackgroundJobState = () => {
      queueMicrotask(() => {
        setHasActiveBackgroundJob(false);
        setBackgroundJobContent('');
      });
    };

    if (!activeThreadId) {
      updateBackgroundJobState(false);
      return;
    }

    // Check if there's an active background job for this thread
    const activeOp = operationsManager.getActiveChatJobForThread(activeThreadId);
    const hasJob = !!activeOp;
    updateBackgroundJobState(hasJob);

    if (hasJob) {
      log.debug('Detected active background job for thread', { threadId: activeThreadId });
      
      // Start polling thread storage for updates
      // This shows the user what's being generated in the background
      const pollForUpdates = async () => {
        try {
          const freshThread = await threadStore.getById(activeThreadId);
          if (!freshThread) return;
          
          // Look for streaming message or new assistant messages
          const streamingMsg = freshThread.messages.find(m => m.id.startsWith('streaming-'));
          if (streamingMsg) {
            setBackgroundJobContent(streamingMsg.content);
          } else {
            // Check if a new assistant message was added
            const messageCount = freshThread.messages.length;
            if (messageCount !== lastMessageCountRef.current) {
              lastMessageCountRef.current = messageCount;
              // Refresh threads to update UI
              await refreshThreads();
            }
          }
          
          // Check if background job is still active
          const stillActive = operationsManager.hasActiveChatJob(activeThreadId);
          if (!stillActive) {
            log.debug('Background job completed, stopping poll');
            clearBackgroundJobState();
            if (backgroundPollRef.current) {
              clearInterval(backgroundPollRef.current);
              backgroundPollRef.current = null;
            }
            // Final refresh to get completed message
            await refreshThreads();
          }
        } catch (err) {
          log.warn('Error polling for background job updates', { err });
        }
      };
      
      // Initial poll
      void pollForUpdates();
      
      // Set up interval
      backgroundPollRef.current = setInterval(pollForUpdates, BACKGROUND_JOB_POLL_INTERVAL_MS);
    } else {
      // No active job, clear any previous polling
      if (backgroundPollRef.current) {
        clearInterval(backgroundPollRef.current);
        backgroundPollRef.current = null;
      }
      clearBackgroundJobState();
    }

    return () => {
      if (backgroundPollRef.current) {
        clearInterval(backgroundPollRef.current);
        backgroundPollRef.current = null;
      }
    };
  }, [activeThreadId, refreshThreads]);

  useEffect(() => {
    if (isThreadsLoading) return;
    if (streamingThreadIds.length === 0) return;
    if (activeThreadId) return;

    // Auto-select the most recent streaming thread after reload/navigation.
    const latestStreamingId = streamingThreadIds[streamingThreadIds.length - 1];
    if (latestStreamingId) {
      selectThread(latestStreamingId);
    }
  }, [isThreadsLoading, streamingThreadIds, activeThreadId, selectThread]);

  useEffect(() => {
    if (isThreadsLoading || threads.length === 0) return;

    const hasActiveStreams = streamingThreadIds.length > 0;
    const updates = threads
      .map((thread) => {
        if (thread.messages.some((message) => message.id === 'streaming')) {
          if (hasActiveStreams && streamingThreadIds.includes(thread.id)) {
            return null;
          }
          return finalizeInterruptedMessage(thread);
        }
        return null;
      })
      .filter((thread): thread is Thread => Boolean(thread));

    if (updates.length === 0) return;

    void Promise.all(updates.map((thread) => threadStore.update(thread)));
  }, [isThreadsLoading, threads, streamingThreadIds]);

  // Subscribe to thread data changes from background jobs
  useEffect(() => {
    const handleThreadDataChanged = async (event: Event) => {
      const customEvent = event as CustomEvent<{ threadId?: string }>;
      const changedThreadId = customEvent.detail?.threadId;
      
      log.debug('Thread data changed event received', { changedThreadId });
      
      // Refresh threads from storage
      try {
        await refreshThreads();
        log.debug('Threads refreshed from storage after background job');
      } catch (err) {
        log.warn('Failed to refresh threads after background job', { err });
      }
    };

    window.addEventListener(THREAD_DATA_CHANGED, handleThreadDataChanged);
    return () => {
      window.removeEventListener(THREAD_DATA_CHANGED, handleThreadDataChanged);
    };
  }, [refreshThreads]);

  // Subscribe to operations manager to detect background job state changes
  useEffect(() => {
    if (!activeThreadId) return;
    
    const unsubscribe = operationsManager.subscribe(() => {
      // Check if the background job state changed for the active thread
      const stillActive = operationsManager.hasActiveChatJob(activeThreadId);
      
      if (hasActiveBackgroundJob && !stillActive) {
        // Job completed! Update state and refresh threads
        log.debug('Background job state changed - job completed');
        setHasActiveBackgroundJob(false);
        setBackgroundJobContent('');
        void refreshThreads();
      } else if (!hasActiveBackgroundJob && stillActive) {
        // Job started (e.g., from another tab) - start tracking
        log.debug('Background job state changed - job started');
        setHasActiveBackgroundJob(true);
      }
    });
    
    return unsubscribe;
  }, [activeThreadId, hasActiveBackgroundJob, refreshThreads]);

  // Wrap stopStreaming to stop both SSE stream AND background job
  const stopStreaming = useCallback(async () => {
    if (activeThreadId) {
      // Stop SSE stream
      stopStreamingBase(activeThreadId);
      
      // Also cancel background job if one is running
      const cancelled = await operationsManager.cancelChatJobForThread(activeThreadId);
      if (cancelled) {
        log.debug('Cancelled background chat job', { threadId: activeThreadId });
        setHasActiveBackgroundJob(false);
        setBackgroundJobContent('');
      }
    } else {
      // Stop all if no active thread
      stopStreamingBase();
    }
  }, [activeThreadId, stopStreamingBase]);

  /**
   * Send a message and save to the active thread.
   *
   * Handles:
   * 1. Adding user message to thread
   * 2. Streaming the response
   * 3. Saving assistant message to thread on completion
   *
   * Now supports multiple concurrent streams - each thread can stream independently.
   *
   * @param content - Message content
   * @param options - Send options
   */
  const sendMessage = useCallback(
    async (content: string, options: SendLearningMessageOptions = {}) => {
      const message = content.trim();
      if (!message) return;

      const { useGitHubTools = false, repos, threadId: explicitThreadId } = options;
      let lastPartialSaveMs = 0;
      let lastPartialContent = '';
      
      log.debug('sendMessage called:', { explicitThreadId, hasActiveThread: !!activeThread });

      // If explicit threadId provided, look it up directly from storage
      // This avoids race conditions when thread was just created but state hasn't updated
      let thread: Thread | null = null;
      
      if (explicitThreadId) {
        thread = await threadStore.getById(explicitThreadId) ?? null;
        log.debug('Looked up thread by explicit ID:', { found: !!thread, title: thread?.title });
      }
      
      // Fall back to active thread from React state
      if (!thread) {
        thread = activeThread;
        log.debug('Fell back to activeThread:', { found: !!thread, title: thread?.title });
      }

      if (!thread) {
        // Auto-create a thread with the first few words as title
        // Include passed repos as initial context
        const title = message.length > 30 ? `${message.slice(0, 30)}...` : message;
        log.debug('Auto-creating thread with title:', title);
        thread = await createThread({ 
          title,
          context: repos && repos.length > 0 ? { repos } : undefined,
        }, true);
      }

      log.debug('Using thread:', { id: thread.id, title: thread.title });

      // Capture thread ID before streaming - this ensures messages go to the
      // correct thread even if user switches threads during streaming
      const targetThreadId = thread.id;
      
      // Auto-rename "New Thread" based on first message content (AC: title generation)
      // This handles the case where user clicks "+" to create a thread before sending a message
      const isNewThreadDefault = thread.title === 'New Thread' && thread.messages.length === 0;
      if (isNewThreadDefault) {
        const autoTitle = message.length > 30 ? `${message.slice(0, 30)}...` : message;
        log.debug('Auto-renaming new thread:', { from: thread.title, to: autoTitle });
        // Update thread title (this persists to storage via threadStore)
        const renamedThread = await threadStore.rename(targetThreadId, autoTitle);
        if (renamedThread) {
          // Update our local thread reference so subsequent updates don't overwrite the title
          thread = renamedThread;
          // Also refresh React state
          await refreshThreads();
        }
      }
      
      // Check if THIS thread is already streaming (don't block other threads)
      if (isStreamingConversation(targetThreadId)) {
        log.warn(`Thread ${targetThreadId} is already streaming`);
        return;
      }

      // Use repos from options first, then thread context
      const effectiveRepos = repos ?? thread.context.repos;

      // Add user message to thread
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: now(),
      };

      updateActiveThread({
        messages: [...thread.messages, userMessage],
      }, targetThreadId);

      // Define onComplete callback - this runs outside React lifecycle,
      // so it persists even if user navigates away during streaming
      const handleStreamComplete = async (state: StreamState) => {
        log.debug('Stream completed, persisting to thread:', { 
          threadId: targetThreadId, 
          status: state.status,
          hasContent: !!state.content,
        });
        
        // Convert stream state to thread message
        const threadMessage = streamStateToThreadMessage(state);

        // Get fresh thread state directly from storage to avoid stale data
        // This is critical because the thread state may have changed during streaming
        // (e.g., user navigated away or switched threads)
        const freshThread = await threadStore.getById(targetThreadId);
        
        if (freshThread) {
          const cleanedThread = removeStreamingMessage(freshThread);

          if (!threadMessage) {
            if (cleanedThread !== freshThread) {
              await threadStore.update(cleanedThread);
            }
            log.debug('No message to persist (empty or error)');
            return;
          }

          const updatedThread: Thread = {
            ...cleanedThread,
            messages: [...cleanedThread.messages, threadMessage],
            updatedAt: now(),
          };
          await threadStore.update(updatedThread);
          log.debug('Persisted message to thread storage');
          
          // Try to refresh React state - this is best-effort since component may be unmounted
          try {
            await refreshThreads();
          } catch {
            // Component unmounted, that's OK - storage is persisted
            log.debug('Could not refresh React state (component may be unmounted)');
          }
        } else {
          log.warn('Thread not found for persistence:', targetThreadId);
        }
      };

      const handleStreamUpdate = (state: StreamState) => {
        if (state.status !== 'pending' && state.status !== 'streaming') return;
        const partialContent = state.streamingBuffer?.length
          ? state.streamingBuffer
          : state.content;
        if (!partialContent) return;

        const nowMs = Date.now();
        if (partialContent === lastPartialContent) return;
        if (nowMs - lastPartialSaveMs < STREAMING_PARTIAL_APPEND_MS) return;

        lastPartialSaveMs = nowMs;
        lastPartialContent = partialContent;

        void (async () => {
          try {
            const freshThread = await threadStore.getById(targetThreadId);
            if (!freshThread) return;
            const updatedThread = upsertStreamingMessage(
              freshThread,
              partialContent,
              state.toolCalls,
              state.hasActionableItem,
              state.wasInterrupted
            );
            await threadStore.update(updatedThread);
          } catch (error) {
            log.warn('Failed to persist streaming update', { error });
          }
        })();
      };

      // Start a background job in parallel with SSE streaming.
      // This ensures the response is generated and saved even if the user navigates away.
      // The SSE stream provides real-time UI updates, while the background job provides
      // navigation-proof persistence.
      log.debug('Starting background chat job for resilience', { threadId: targetThreadId });
      operationsManager.startBackgroundJob({
        type: 'chat-response',
        targetId: targetThreadId,
        input: {
          threadId: targetThreadId,
          prompt: message,
          repos: effectiveRepos,
          learningMode: true,
          useGitHubTools,
        },
      }).catch(err => {
        // Don't block on background job - it's a safety net
        log.warn('Failed to start background chat job (SSE will still work)', { err });
      });

      // Send streaming message with learning mode enabled
      // The onComplete callback handles persistence outside React lifecycle
      await sendStreamingMessage(message, {
        useGitHubTools,
        repos: effectiveRepos,
        conversationId: targetThreadId,
        learningMode: true,
        onComplete: handleStreamComplete,
        onUpdate: handleStreamUpdate,
      });

      // NOTE: We no longer handle persistence here - it's done in onComplete callback
      // which runs even if this component unmounts during streaming
    },
    [
      activeThread,
      createThread,
      updateActiveThread,
      sendStreamingMessage,
      refreshThreads,
      isStreamingConversation,
    ]
  );

  return {
    // State
    threads,
    activeThread,
    activeThreadId,
    isThreadsLoading,
    isStreaming,
    streamingContent,
    streamingThreadId,
    streamingThreadIds,
    // Actions
    sendMessage,
    stopStreaming,
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    updateContext,
  };
}
