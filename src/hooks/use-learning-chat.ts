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
import type { ChatResponseProfileId, CapabilitiesArg } from '@/lib/copilot/profile-types';
import { now } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useLearningChatStream } from './use-learning-chat-stream';
import { useThreads, type UseThreadsReturn } from './use-threads';

const log = logger.withTag('useLearningChat');

// ============================================================================
// Pure helpers (module scope to keep useCallback bodies short)
// ============================================================================

/** Title used to seed an auto-created thread. Caps at 30 chars + ellipsis. */
function deriveAutoTitle(message: string): string {
  return message.length > 30 ? `${message.slice(0, 30)}...` : message;
}

/**
 * Storage is the source of truth for `isStreaming`; React state can lag
 * by up to one poll interval, so we always re-read from storage before
 * dispatching a new chat job.
 */
async function isStorageStreaming(threadId: string): Promise<boolean> {
  const fresh = await threadStore.getById(threadId);
  return fresh?.isStreaming === true;
}

// ============================================================================
// Types
// ============================================================================

/** Options for sending a learning chat message */
interface SendLearningMessageOptions {
  /** Base chat profile to use (defaults to `'learning'`). */
  profile?: ChatResponseProfileId;
  /**
   * Capability selection for this turn. `'auto'` lets the server elevate
   * based on prompt heuristics; an explicit array opts into specific
   * MCP/native capabilities. Omitting the field uses the profile's
   * defaults.
   */
  capabilities?: CapabilitiesArg;
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
  /** Live streaming assistant content for the active thread, served from `chatStreamStore` rather than the durable thread. */
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
   * Resolve which thread a new message targets: explicit id wins, then the
   * active thread, then auto-create one with a title derived from the
   * message. Auto-rename placeholder threads on first send so the sidebar
   * always shows something meaningful.
   */
  const resolveTargetThread = useCallback(
    async (
      message: string,
      explicitThreadId: string | undefined,
      repos: RepoReference[] | undefined,
    ): Promise<Thread> => {
      const located = explicitThreadId ? await threadStore.getById(explicitThreadId) : activeThread;
      if (located) {
        const isPlaceholder = located.title === 'New Thread' && located.messages.length === 0;
        if (!isPlaceholder) return located;
        const renamed = await threadStore.rename(located.id, deriveAutoTitle(message));
        if (!renamed) return located;
        await refreshThreads();
        return renamed;
      }
      return createThread(
        {
          title: deriveAutoTitle(message),
          context: repos && repos.length > 0 ? { repos } : undefined,
        },
        true,
      );
    },
    [activeThread, createThread, refreshThreads],
  );

  /**
   * POST to `/api/jobs` to start the worker chat-response job, then seed
   * the client-side stream store and operations snapshot in the order the
   * SSE-attach effect expects.
   */
  const startChatJob = useCallback(
    async (
      targetThreadId: string,
      message: string,
      effectiveRepos: RepoReference[],
      profile: ChatResponseProfileId,
      capabilities: CapabilitiesArg | undefined,
    ): Promise<void> => {
      const assistantMessageId = crypto.randomUUID();
      const { id: jobId } = await apiPost<{ id: string }>(
        '/api/jobs',
        {
          type: 'chat-response',
          targetId: targetThreadId,
          input: {
            threadId: targetThreadId,
            prompt: message,
            assistantMessageId,
            profile,
            ...(capabilities !== undefined ? { capabilities } : {}),
            repos: effectiveRepos.map((r) => r.fullName),
          },
        },
        {
          clientTrigger: createLearningChatSendTrigger(targetThreadId, assistantMessageId),
        },
      );

      // Seed the chat-stream store BEFORE registering with operationsManager
      // so the SSE-attach effect finds a pre-existing record.
      registerStream(jobId, targetThreadId, assistantMessageId);
      operationsManager.registerExistingJob(jobId, 'chat-response', targetThreadId, assistantMessageId);
      await refreshThreads();
    },
    [refreshThreads, registerStream],
  );

  const sendMessage = useCallback(
    async (content: string, options: SendLearningMessageOptions = {}) => {
      const message = content.trim();
      if (!message) return;

      const { profile = 'learning', capabilities, repos, threadId: explicitThreadId } = options;
      const thread = await resolveTargetThread(message, explicitThreadId, repos);

      if (await isStorageStreaming(thread.id)) {
        log.warn(`Thread ${thread.id} is already streaming`);
        return;
      }

      const effectiveRepos = repos ?? thread.context?.repos ?? [];
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: now(),
      };
      await updateActiveThread({ messages: [...thread.messages, userMessage] }, thread.id);

      // Mark pending IMMEDIATELY so polling fires before storage flips isStreaming.
      markStreamPending(thread.id, userMessage.id);

      try {
        await startChatJob(thread.id, message, effectiveRepos, profile, capabilities);
      } catch (err) {
        log.error('Failed to start chat response job:', err);
        clearPendingStream(thread.id);
      }
    },
    [clearPendingStream, markStreamPending, resolveTargetThread, startChatJob, updateActiveThread],
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
