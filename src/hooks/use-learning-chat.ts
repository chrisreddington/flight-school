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

import { useCallback, useEffect, useMemo, useState } from 'react';

import { logger } from '@/lib/logger';
import type { Message, RepoReference, Thread } from '@/lib/threads';
import { THREAD_DATA_CHANGED_EVENT, threadStore } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useThreads, type UseThreadsReturn } from './use-threads';

const log = logger.withTag('useLearningChat');

/** How long a thread can stay `isStreaming: true` without a content update before being considered stale. */
const STALE_STREAM_THRESHOLD_MS = 5_000;

// ============================================================================
// Types
// ============================================================================

/** Options for sending a learning chat message */
interface SendLearningMessageOptions {
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
type UseLearningChatReturn = UseLearningChatState & UseLearningChatActions;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Converts a stored streaming message into a completed, interrupted message.
 */
function finalizeInterruptedMessage(thread: Thread): Thread | null {
  // Find streaming message (now uses 'streaming-{jobId}' format)
  const streamingMessage = thread.messages.find((message) => 
    message.id.startsWith('streaming-')
  );
  if (!streamingMessage) return null;

  // Remove cursor if present, then trim
  const trimmedContent = streamingMessage.content.replace(' ▊', '').trim();
  if (!trimmedContent) {
    // No content - just remove the streaming message
    const withoutStreaming = thread.messages.filter((m) => !m.id.startsWith('streaming-'));
    return {
      ...thread,
      messages: withoutStreaming,
      updatedAt: now(),
      isStreaming: false,
    };
  }

  const interruptionNote = '*(Response interrupted)*';
  const content = streamingMessage.content.includes(interruptionNote)
    ? streamingMessage.content.replace(' ▊', '')
    : `${trimmedContent}\n\n${interruptionNote}`;

  const finalizedMessage: Message = {
    ...streamingMessage,
    id: generateMessageId(),
    content,
    timestamp: now(),
  };

  const withoutStreaming = thread.messages.filter((m) => !m.id.startsWith('streaming-'));
  return {
    ...thread,
    messages: [...withoutStreaming, finalizedMessage],
    updatedAt: now(),
    isStreaming: false,
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

  // Derive streaming thread IDs from storage (threads with isStreaming: true)
  // This is the SINGLE SOURCE OF TRUTH for streaming state
  const streamingThreadIds = useMemo(() => 
    threads.filter(t => t.isStreaming === true).map(t => t.id),
    [threads]
  );
  
  // For backward compatibility, expose a single streamingThreadId (most recently started)
  const streamingThreadId = streamingThreadIds[streamingThreadIds.length - 1] ?? null;
  
  // Maps threadId → userMessageId for the message that triggered the pending stream
  const [pendingStreamMessages, setPendingStreamMessages] = useState<Map<string, string>>(new Map());
  
  // Combine storage-derived streaming IDs with pending ones
  const allStreamingThreadIds = useMemo(() => {
    const combined = new Set([...streamingThreadIds, ...pendingStreamMessages.keys()]);
    return Array.from(combined);
  }, [streamingThreadIds, pendingStreamMessages]);
  
  // Check if active thread is streaming (from storage OR pending)
  const isStreaming = activeThread?.isStreaming === true || 
    (activeThreadId ? pendingStreamMessages.has(activeThreadId) : false);
  
  // Streaming content comes from the thread messages in storage
  // The streaming message has cursor ` ▊` which gives the typing effect
  const streamingContent = useMemo(() => {
    if (!activeThread?.isStreaming) return '';
    const streamingMsg = activeThread.messages.find(m => m.id.startsWith('streaming-'));
    return streamingMsg?.content ?? '';
  }, [activeThread]);

  // Poll for thread updates while any thread is streaming (including pending)
  useEffect(() => {
    if (allStreamingThreadIds.length === 0) return;
    
    const POLL_INTERVAL_MS = 400; // Match job write frequency
    log.debug('Starting polling for streaming threads', { count: allStreamingThreadIds.length });
    
    const pollInterval = setInterval(() => {
      refreshThreads();
    }, POLL_INTERVAL_MS);
    
    return () => {
      log.debug('Stopping polling for streaming threads');
      clearInterval(pollInterval);
    };
  }, [allStreamingThreadIds.length, refreshThreads]);
  
  // Clean up pending stream IDs once storage reflects the streaming state
  useEffect(() => {
    if (pendingStreamMessages.size === 0) return;
    
    const stillPending = new Map<string, string>();
    for (const [threadId, userMsgId] of pendingStreamMessages) {
      const thread = threads.find(t => t.id === threadId);
      if (!thread) {
        stillPending.set(threadId, userMsgId);
      } else if (thread.isStreaming) {
        // Storage has caught up to the streaming state - no longer pending
      } else {
        const hasStreamingMsg = thread.messages.some(m => m.id.startsWith('streaming-'));
        // Only consider a response "completed" if it appears AFTER our specific user message
        const userMsgIdx = thread.messages.findIndex(m => m.id === userMsgId);
        const hasNewResponse =
          userMsgIdx !== -1 &&
          thread.messages
            .slice(userMsgIdx + 1)
            .some(m => m.role === 'assistant' && !m.id.startsWith('streaming-'));
        if (!hasStreamingMsg && !hasNewResponse) {
          // Still waiting for job to write first content
          stillPending.set(threadId, userMsgId);
        }
      }
    }
    
    if (stillPending.size !== pendingStreamMessages.size) {
      setPendingStreamMessages(stillPending);
    }
  }, [threads, pendingStreamMessages]);

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

    const nowMs = Date.now();
    const updates = threads
      .map((thread) => {
        if (!thread.isStreaming) return null;

        // Never touch streams we started in this session — they're actively handled
        if (pendingStreamMessages.has(thread.id)) return null;

        const hasStreamingMessage = thread.messages.some((m) =>
          m.id.startsWith('streaming-')
        );
        // A stream is stale when the job executor has stopped updating the thread
        // (live jobs write every ~400ms, so 5s with no update means the job is dead)
        const isStale =
          nowMs - new Date(thread.updatedAt).getTime() > STALE_STREAM_THRESHOLD_MS;

        if (hasStreamingMessage) {
          // Wait for the staleness threshold before finalizing — avoids racing a
          // live stream that survived a very recent server reload
          if (!isStale) return null;
          return finalizeInterruptedMessage(thread);
        }

        // isStreaming: true with no streaming message means the job was interrupted
        // before it wrote any content. Clear the flag immediately.
        return { ...thread, isStreaming: false, updatedAt: now() };
      })
      .filter((thread): thread is Thread => Boolean(thread));

    if (updates.length === 0) return;

    void Promise.all(updates.map((thread) => threadStore.update(thread)));
  }, [isThreadsLoading, threads, pendingStreamMessages]);

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

    window.addEventListener(THREAD_DATA_CHANGED_EVENT, handleThreadDataChanged);
    return () => {
      window.removeEventListener(THREAD_DATA_CHANGED_EVENT, handleThreadDataChanged);
    };
  }, [refreshThreads]);

  // Stop streaming - cancel job and update storage
  const stopStreaming = useCallback(async () => {
    const threadId = activeThreadId;
    if (!threadId) {
      log.warn('No active thread to stop streaming');
      return;
    }
    
    log.debug('Stopping stream for thread:', threadId);
    
    // Remove from pending (stops showing as streaming immediately)
    setPendingStreamMessages(prev => {
      const next = new Map(prev);
      next.delete(threadId);
      return next;
    });
    
    try {
      // 1. Find and cancel any running jobs for this thread
      // We need to find the job by checking jobs API
      const jobsRes = await fetch('/api/jobs');
      if (jobsRes.ok) {
        const { jobs } = await jobsRes.json();
        const runningJobs = jobs.filter((job: { status: string; input?: { threadId?: string } }) => 
          job.status === 'running' && 
          job.input?.threadId === threadId
        );
        
        // Cancel each running job
        for (const job of runningJobs) {
          log.debug('Cancelling job:', job.id);
          await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' });
        }
      }
      
      // 2. Update thread in storage - set isStreaming: false, finalize message
      const thread = await threadStore.getById(threadId);
      if (thread) {
        // Find and finalize the streaming message
        const updatedMessages = thread.messages.map(msg => {
          if (msg.id.startsWith('streaming-')) {
            // Remove cursor and add interruption note
            const content = msg.content.replace(' ▊', '').trim();
            return {
              ...msg,
              id: generateMessageId(), // Give it a permanent ID
              content: content ? `${content}\n\n*(Response stopped)*` : '',
            };
          }
          return msg;
        }).filter(msg => msg.content); // Remove empty messages
        
        await threadStore.update({
          ...thread,
          messages: updatedMessages,
          isStreaming: false,
          updatedAt: now(),
        });
        
        log.debug('Thread updated after stop');
      }
      
      // 3. Refresh to show updated state
      await refreshThreads();
      
    } catch (err) {
      log.error('Failed to stop streaming:', err);
    }
  }, [activeThreadId, refreshThreads]);

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
      
      // Check if THIS thread is already streaming (from storage)
      const threadFromStorage = threads.find(t => t.id === targetThreadId);
      if (threadFromStorage?.isStreaming) {
        log.warn(`Thread ${targetThreadId} is already streaming`);
        return;
      }

      // Use repos from options first, then thread context
      const effectiveRepos = repos ?? thread.context?.repos ?? [];

      // Add user message to thread
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: now(),
      };

      await updateActiveThread({
        messages: [...thread.messages, userMessage],
      }, targetThreadId);

      // Start background job via POST /api/jobs
      // The job writes to storage, and our polling effect refreshes the UI
      log.debug('Starting background job for chat response', { threadId: targetThreadId });
      
      // Mark this thread as pending streaming IMMEDIATELY
      // This triggers polling before storage has isStreaming: true
      setPendingStreamMessages(prev => new Map([...prev, [targetThreadId, userMessage.id]]));
      
      try {
        const jobRes = await fetch('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'chat-response',
            input: {
              threadId: targetThreadId,
              prompt: message,
              learningMode: true,
              useGitHubTools,
              repos: effectiveRepos?.map(r => r.fullName),
            },
          }),
        });

        if (!jobRes.ok) {
          const err = await jobRes.json();
          // Remove from pending on error
          setPendingStreamMessages(prev => {
            const next = new Map(prev);
            next.delete(targetThreadId);
            return next;
          });
          throw new Error(err.error || 'Failed to start job');
        }

        const { id: jobId } = await jobRes.json();
        log.debug(`Started job ${jobId} for thread ${targetThreadId}`);
        
        // Trigger immediate refresh to pick up the isStreaming flag
        await refreshThreads();
      } catch (err) {
        log.error('Failed to start chat response job:', err);
        // Remove from pending on error
        setPendingStreamMessages(prev => {
          const next = new Map(prev);
          next.delete(targetThreadId);
          return next;
        });
      }
    },
    [
      activeThread,
      createThread,
      updateActiveThread,
      refreshThreads,
      threads,
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
    streamingThreadIds: allStreamingThreadIds, // Use combined list including pending
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
