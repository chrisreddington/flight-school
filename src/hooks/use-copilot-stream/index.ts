/**
 * useCopilotStream Hook
 *
 * React hook for streaming Copilot chat responses via Server-Sent Events (SSE).
 * Handles real-time text streaming, tool calls, performance tracking, and abort control.
 *
 * **Key feature:** Streams persist across navigation. The hook subscribes to a global
 * stream store, so streams continue in the background if the user navigates away.
 *
 * @example
 * ```typescript
 * const {
 *   messages,
 *   isLoading,
 *   streamingContent,
 *   sendMessage,
 *   stopStreaming,
 * } = useCopilotStream();
 *
 * // Send a message
 * await sendMessage('How do I use React hooks?');
 *
 * // Stop streaming
 * stopStreaming();
 * ```
 */

'use client';

import { apiPatch } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import { streamStore, type StreamState as GlobalStreamState } from '@/lib/stream-store';
import { now, nowMs } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
    SendMessageOptions,
    StreamingMessage,
    StreamState,
    UseCopilotStreamReturn,
} from './types';

// Re-export types for consumers
export type {
    SendMessageOptions,
    StreamingMessage,
    StreamState,
    ToolCall,
    UseCopilotStreamReturn
} from './types';

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Convert global stream state to local StreamState format
 */
function toLocalStreamState(global: GlobalStreamState): StreamState {
  return {
    isLoading: global.status === 'pending' || global.status === 'streaming',
    streamingContent: global.content,
    abortController: global.abortController ?? null,
    streamingBuffer: global.streamingBuffer ?? '',
    flushTimer: null, // Not tracked locally anymore
  };
}

/**
 * Hook for streaming Copilot chat responses.
 *
 * Key features:
 * - Real-time text streaming via SSE
 * - **Multiple concurrent streams** per conversation ID
 * - **Streams persist across navigation** via global store
 * - Tool call tracking
 * - Performance metrics collection
 * - Per-conversation abort/stop support
 * - Conversation state management
 *
 * @param initialMessages - Optional initial messages
 * @returns Streaming state and actions
 */
export function useCopilotStream(
  initialMessages: StreamingMessage[] = []
): UseCopilotStreamReturn {
  const [messages, setMessages] = useState<StreamingMessage[]>(initialMessages);
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // Track streams locally (synced from global store)
  const [activeStreams, setActiveStreams] = useState<Map<string, StreamState>>(new Map());
  
  // Track which streams we're subscribed to
  const subscribedStreamsRef = useRef<Set<string>>(new Set());
  const unsubscribersRef = useRef<Map<string, () => void>>(new Map());

  // Subscribe to global store activity (for active stream tracking)
  useEffect(() => {
    // Capture refs for cleanup (React lint rule requires this)
    const subscribedStreams = subscribedStreamsRef.current;
    const unsubscribers = unsubscribersRef.current;
    
    const unsubscribe = streamStore.subscribeToActivity((activeIds) => {
      // Subscribe to any new streams we're not already subscribed to
      for (const id of activeIds) {
        if (!subscribedStreams.has(id)) {
          subscribedStreams.add(id);
          const unsub = streamStore.subscribe(id, (state) => {
            setActiveStreams((prev) => {
              const next = new Map(prev);
              if (state.status === 'completed' || state.status === 'error' || state.status === 'aborted') {
                // Remove completed streams from active
                next.delete(id);
              } else {
                next.set(id, toLocalStreamState(state));
              }
              return next;
            });
          });
          unsubscribers.set(id, unsub);
        }
      }
      
      // Clean up subscriptions for streams that are no longer active
      for (const id of subscribedStreams) {
        if (!activeIds.includes(id)) {
          const unsub = unsubscribers.get(id);
          if (unsub) {
            unsub();
            unsubscribers.delete(id);
          }
          subscribedStreams.delete(id);
        }
      }
    });

    return () => {
      unsubscribe();
      // Clean up all subscriptions on unmount (but DON'T abort streams!)
      for (const unsub of unsubscribers.values()) {
        unsub();
      }
      unsubscribers.clear();
      subscribedStreams.clear();
    };
  }, []);

  // Derived state: any stream is loading
  const isLoading = activeStreams.size > 0;
  
  // For backwards compatibility, show content from most recent stream
  const streamingContent = useMemo(() => {
    if (activeStreams.size === 0) return '';
    const streams = Array.from(activeStreams.values());
    return streams[streams.length - 1]?.streamingContent ?? '';
  }, [activeStreams]);

  /**
   * Ensure a conversation ID exists.
   */
  const ensureConversationId = useCallback(() => {
    if (conversationId) return conversationId;
    const fallbackId = `${nowMs()}-${Math.random().toString(36).slice(2, 10)}`;
    const newId = globalThis.crypto?.randomUUID?.() ?? fallbackId;
    setConversationId(newId);
    return newId;
  }, [conversationId]);

  /**
   * Clear all messages.
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * Reset conversation (clear messages and ID).
   */
  const resetConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
  }, []);

  /**
   * Stop the streaming response for a specific conversation (or all if not specified).
   */
  const stopStreaming = useCallback((targetConversationId?: string) => {
    if (targetConversationId) {
      streamStore.stopStream(targetConversationId);
    } else {
      // Stop all active streams
      const activeIds = streamStore.getActiveStreamIds();
      for (const id of activeIds) {
        streamStore.stopStream(id);
      }
    }
  }, []);

  /**
   * Check if a specific conversation is streaming.
   */
  const isStreamingConversation = useCallback((targetConversationId: string): boolean => {
    return streamStore.isStreaming(targetConversationId);
  }, []);

  /**
   * Get streaming content for a specific conversation.
   */
  const getStreamingContent = useCallback((targetConversationId: string): string => {
    const stream = streamStore.getStream(targetConversationId);
    return stream?.content ?? '';
  }, []);

  /**
   * Send a message and stream the response.
   *
   * @param content - Message content
   * @param options - Send options
   * @returns The assistant's response message, or null on cancellation/error
   */
  const sendMessage = useCallback(async (
    content: string,
    options: SendMessageOptions = {}
  ): Promise<StreamingMessage | null> => {
    const message = content.trim();
    if (!message) return null;

    const { useGitHubTools = false, repos, conversationId: customConversationId, learningMode = false, onComplete } = options;
    
    // Use provided conversation ID or generate one
    const streamId = customConversationId ?? ensureConversationId();
    
    // Check if this specific conversation is already streaming
    if (streamStore.isStreaming(streamId)) {
      logger.warn('Conversation is already streaming, ignoring new message', { streamId }, 'useCopilotStream');
      return null;
    }

    // Add user message immediately
    const userMessage: StreamingMessage = {
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Track start time for client metrics
    const startTime = performance.now();

    // Start stream via global store
    const finalState = await streamStore.startStream({
      type: 'copilot',
      prompt: message,
      useGitHubTools,
      conversationId: streamId,
      learningMode,
      repos: repos?.map((r) => ({ fullName: r.fullName })),
      onComplete,
    });

    // Calculate client-side total time
    const clientTotalMs = Math.round(performance.now() - startTime);

    // Update activity metrics if we have an activity event ID
    if (finalState.serverMeta?.activityEventId && finalState.clientFirstTokenMs != null) {
      apiPatch('/api/ai-activity/metrics', {
        eventId: finalState.serverMeta.activityEventId,
        clientMetrics: {
          firstTokenMs: finalState.clientFirstTokenMs,
          totalMs: clientTotalMs,
        },
      }, { throwOnError: false }).catch((err) => {
        logger.warn('Failed to update activity metrics', { err }, 'useCopilotStream');
      });
    }

    // Handle different final states
    if (finalState.status === 'completed') {
      const assistantMessage: StreamingMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: finalState.content,
        timestamp: now(),
        perf: {
          clientTotalMs,
          clientFirstTokenMs: finalState.clientFirstTokenMs,
          serverTotalMs: finalState.serverMeta?.totalMs,
          serverFirstTokenMs: finalState.serverMeta?.firstDeltaMs ?? undefined,
          sessionCreateMs: finalState.serverMeta?.sessionCreateMs ?? undefined,
          sessionPoolHit: finalState.serverMeta?.sessionPoolHit ?? undefined,
          mcpEnabled: finalState.serverMeta?.mcpEnabled ?? undefined,
          sessionReused: finalState.serverMeta?.sessionReused ?? undefined,
          model: finalState.serverMeta?.model,
        },
        toolCalls: finalState.toolCalls.length > 0 ? finalState.toolCalls : undefined,
        hasActionableItem: finalState.hasActionableItem,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      return assistantMessage;
    }

    if (finalState.status === 'aborted') {
      if (finalState.content) {
        const partialMessage: StreamingMessage = {
          id: generateMessageId(),
          role: 'assistant',
          content: finalState.content + '\n\n*(Response stopped)*',
          timestamp: now(),
          toolCalls: finalState.toolCalls.length > 0 ? finalState.toolCalls : undefined,
        };
        setMessages((prev) => [...prev, partialMessage]);
        return partialMessage;
      }
      return null;
    }

    if (finalState.status === 'error') {
      const errorMessage: StreamingMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: finalState.error ?? 'Unknown error',
        timestamp: now(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      return errorMessage;
    }

    return null;
  }, [ensureConversationId]);

  return {
    // State
    messages,
    isLoading,
    streamingContent,
    conversationId,
    activeStreams,
    // Actions
    sendMessage,
    stopStreaming,
    clearMessages,
    resetConversation,
    setMessages,
    isStreamingConversation,
    getStreamingContent,
  };
}
