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

import { useCallback } from 'react';

import { apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { createLearningChatSendTrigger } from '@/lib/observability/job-trigger-builders';
import { operationsManager } from '@/lib/operations';
import type { Message, RepoReference, Thread } from '@/lib/threads';
import { threadStore } from '@/lib/threads';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useLearningChatStream } from './use-learning-chat-stream';
import { useThreads, type UseThreadsReturn } from './use-threads';

const log = logger.withTag('useLearningChat');

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
  /** Live streaming assistant content for the active thread (post-Phase-5: served from chatStreamStore, not the durable thread). */
  streamingContent: string;
  /** Stable id of the in-flight assistant message in the active thread, or null when nothing is streaming. */
  streamingAssistantMessageId: string | null;
  /** Tool events emitted by the in-flight chat job for the active thread. */
  streamingToolEvents: import('@/lib/threads').ToolCallEvent[];
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

  const {
    allStreamingThreadIds,
    clearPendingStream,
    isStreaming,
    markStreamPending,
    registerStream,
    stopStreaming,
    streamingAssistantMessageId,
    streamingContent,
    streamingThreadId,
    streamingToolEvents,
  } = useLearningChatStream({
    threads,
    activeThread,
    activeThreadId,
    isThreadsLoading,
    refreshThreads,
    selectThread,
  });

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

      /**
       * Locate the thread the message belongs to:
       *  1. explicit id wins (bypasses React-state lag after just-created threads),
       *  2. otherwise the active thread,
       *  3. otherwise auto-create one titled from the first ~30 chars.
       */
      const resolveTargetThread = async (): Promise<Thread> => {
        if (explicitThreadId) {
          const byId = await threadStore.getById(explicitThreadId);
          if (byId) {
            log.debug('Looked up thread by explicit ID:', { title: byId.title });
            return byId;
          }
        }
        if (activeThread) {
          log.debug('Using activeThread:', { title: activeThread.title });
          return activeThread;
        }
        const title = message.length > 30 ? `${message.slice(0, 30)}...` : message;
        log.debug('Auto-creating thread with title:', title);
        return createThread({
          title,
          context: repos && repos.length > 0 ? { repos } : undefined,
        }, true);
      };

      /**
       * Auto-rename the placeholder "New Thread" using the first message so
       * the sidebar shows something meaningful. Persists via threadStore and
       * refreshes React state. Returns the (possibly renamed) thread.
       */
      const ensureMeaningfulTitle = async (thread: Thread): Promise<Thread> => {
        const isPlaceholderTitle = thread.title === 'New Thread' && thread.messages.length === 0;
        if (!isPlaceholderTitle) return thread;

        const autoTitle = message.length > 30 ? `${message.slice(0, 30)}...` : message;
        log.debug('Auto-renaming new thread:', { from: thread.title, to: autoTitle });
        const renamed = await threadStore.rename(thread.id, autoTitle);
        if (!renamed) return thread;
        await refreshThreads();
        return renamed;
      };

      /**
       * Storage is the source of truth for `isStreaming`; React state can lag
       * by up to one poll interval, so re-read from storage to avoid double-
       * dispatching a chat job to a thread that already has one in flight.
       */
      const isAlreadyStreaming = async (threadId: string): Promise<boolean> => {
        const fresh = await threadStore.getById(threadId);
        return fresh?.isStreaming === true;
      };

      const appendUserMessage = async (thread: Thread): Promise<Message> => {
        const userMessage: Message = {
          id: generateMessageId(),
          role: 'user',
          content: message,
          timestamp: now(),
        };
        await updateActiveThread({ messages: [...thread.messages, userMessage] }, thread.id);
        return userMessage;
      };

      /**
       * POST to `/api/jobs` to start the worker chat-response job, then
       * seed the client-side stream store and operations snapshot in the
       * order the SSE-attach effect expects.
       */
      const startChatJob = async (
        targetThreadId: string,
        effectiveRepos: RepoReference[],
      ): Promise<void> => {
        log.debug('Starting background job for chat response', { threadId: targetThreadId });
        // Stable id for streaming delta reconciliation and chat job idempotency.
        const assistantMessageId = crypto.randomUUID();
        const { id: jobId } = await apiPost<{ id: string }>('/api/jobs', {
          type: 'chat-response',
          targetId: targetThreadId,
          input: {
            threadId: targetThreadId,
            prompt: message,
            assistantMessageId,
            learningMode: true,
            useGitHubTools,
            repos: effectiveRepos.map((r) => r.fullName),
          },
        }, {
          clientTrigger: createLearningChatSendTrigger(targetThreadId, assistantMessageId),
        });
        log.debug(`Started job ${jobId} for thread ${targetThreadId}`);

        // Seed the chat-stream store BEFORE registering with operationsManager
        // so the SSE-attach effect finds a pre-existing record and never has
        // to fall back to the defensive synthetic-record path.
        registerStream(jobId, targetThreadId, assistantMessageId);

        // Chat creation uses raw apiPost (not startBackgroundJob) because chat
        // streams over SSE and does not want the per-job status poll attached.
        // We register the job into the operations snapshot here so the SSE
        // subscription hook can find the jobId for this thread.
        operationsManager.registerExistingJob(
          jobId,
          'chat-response',
          targetThreadId,
          assistantMessageId,
        );

        await refreshThreads();
      };

      let thread = await resolveTargetThread();
      thread = await ensureMeaningfulTitle(thread);
      log.debug('Using thread:', { id: thread.id, title: thread.title });

      const targetThreadId = thread.id;
      if (await isAlreadyStreaming(targetThreadId)) {
        log.warn(`Thread ${targetThreadId} is already streaming`);
        return;
      }

      const effectiveRepos = repos ?? thread.context?.repos ?? [];
      const userMessage = await appendUserMessage(thread);

      // Mark pending IMMEDIATELY so polling fires before storage flips isStreaming.
      markStreamPending(targetThreadId, userMessage.id);

      try {
        await startChatJob(targetThreadId, effectiveRepos);
      } catch (err) {
        log.error('Failed to start chat response job:', err);
        clearPendingStream(targetThreadId);
      }
    },
    [
      activeThread,
      clearPendingStream,
      createThread,
      markStreamPending,
      registerStream,
      updateActiveThread,
      refreshThreads,
    ]
  );

  return {
    // State
    threads,
    activeThread,
    activeThreadId,
    isThreadsLoading,
    isStreaming,
    streamingAssistantMessageId,
    streamingContent,
    streamingThreadId,
    streamingThreadIds: allStreamingThreadIds, // Use combined list including pending
    streamingToolEvents,
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
