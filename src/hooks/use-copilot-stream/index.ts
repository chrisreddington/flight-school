/**
 * useCopilotStream Hook
 *
 * React hook for streaming Copilot chat responses via Server-Sent Events (SSE).
 * Handles real-time text streaming, tool calls, performance tracking, and abort control.
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
import { now, nowMs } from '@/lib/utils/date-utils';
import { generateMessageId } from '@/lib/utils/id-generator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
    SendMessageOptions,
    StreamingMessage,
    StreamState,
    ToolCall,
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
// Constants
// ============================================================================

/** Flush interval for streaming content (ms) */
const STREAMING_FLUSH_INTERVAL = 50;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for streaming Copilot chat responses.
 *
 * Key features:
 * - Real-time text streaming via SSE
 * - **Multiple concurrent streams** per conversation ID
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
  
  // Track multiple concurrent streams by conversation ID
  // Using ref + state: ref for abort controllers (no re-render needed), state for UI updates
  const activeStreamsRef = useRef<Map<string, StreamState>>(new Map());
  const [activeStreams, setActiveStreams] = useState<Map<string, StreamState>>(new Map());

  // Cleanup effect: abort all streams and clear timers on unmount
  // This prevents memory leaks from orphaned timers/controllers
  useEffect(() => {
    // Capture ref value for cleanup (React lint rule requires this for refs that may change)
    const streamsRef = activeStreamsRef;
    return () => {
      streamsRef.current.forEach((stream) => {
        if (stream.flushTimer !== null) {
          window.clearTimeout(stream.flushTimer);
        }
        stream.abortController?.abort();
      });
      streamsRef.current.clear();
    };
  }, []);

  // Derived state: any stream is loading
  const isLoading = activeStreams.size > 0;
  
  // For backwards compatibility, show content from most recent stream
  const streamingContent = useMemo(() => {
    if (activeStreams.size === 0) return '';
    // Get the most recently started stream's content
    const streams = Array.from(activeStreams.values());
    return streams[streams.length - 1]?.streamingContent ?? '';
  }, [activeStreams]);

  /**
   * Generate a unique message ID.
   */
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
   * Update a stream's state and trigger re-render.
   */
  const updateStreamState = useCallback((streamId: string, update: Partial<StreamState>) => {
    const current = activeStreamsRef.current.get(streamId);
    if (current) {
      const updated = { ...current, ...update };
      activeStreamsRef.current.set(streamId, updated);
      setActiveStreams(new Map(activeStreamsRef.current));
    }
  }, []);

  /**
   * Remove a stream from tracking.
   */
  const removeStream = useCallback((streamId: string) => {
    const stream = activeStreamsRef.current.get(streamId);
    if (stream && stream.flushTimer !== null) {
      window.clearTimeout(stream.flushTimer);
    }
    activeStreamsRef.current.delete(streamId);
    setActiveStreams(new Map(activeStreamsRef.current));
  }, []);

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
      // Stop specific conversation
      const stream = activeStreamsRef.current.get(targetConversationId);
      if (stream?.abortController) {
        stream.abortController.abort();
      }
    } else {
      // Stop all streams (backwards compatibility)
      for (const stream of activeStreamsRef.current.values()) {
        if (stream.abortController) {
          stream.abortController.abort();
        }
      }
    }
  }, []);

  /**
   * Check if a specific conversation is streaming.
   */
  const isStreamingConversation = useCallback((targetConversationId: string): boolean => {
    return activeStreamsRef.current.has(targetConversationId);
  }, []);

  /**
   * Get streaming content for a specific conversation.
   */
  const getStreamingContent = useCallback((targetConversationId: string): string => {
    return activeStreamsRef.current.get(targetConversationId)?.streamingContent ?? '';
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

    const { useGitHubTools = false, repos, conversationId: customConversationId, learningMode = false } = options;
    
    // Use provided conversation ID or generate one
    const streamId = customConversationId ?? ensureConversationId();
    
    // Check if this specific conversation is already streaming
    if (activeStreamsRef.current.has(streamId)) {
      logger.warn('Conversation is already streaming, ignoring new message', { streamId }, 'useCopilotStream');
      return null;
    }

    // Create abort controller for this stream
    const abortController = new AbortController();
    
    // Initialize stream state
    const streamState: StreamState = {
      isLoading: true,
      streamingContent: '',
      abortController,
      streamingBuffer: '',
      flushTimer: null,
    };
    activeStreamsRef.current.set(streamId, streamState);
    setActiveStreams(new Map(activeStreamsRef.current));

    // Add user message
    const userMessage: StreamingMessage = {
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    // Track tool calls and response content
    const toolCalls: ToolCall[] = [];
    let responseContent = '';
    const startTime = performance.now();
    let clientFirstTokenMs: number | undefined;
    let hasActionableItem = false;
    let activityEventId: string | undefined;
    let serverMeta: {
      totalMs?: number;
      firstDeltaMs?: number | null;
      sessionCreateMs?: number | null;
      sessionPoolHit?: boolean | null;
      mcpEnabled?: boolean | null;
      sessionReused?: boolean | null;
      model?: string;
      activityEventId?: string;
    } | null = null;

    /**
     * Flush streaming buffer to state for this specific stream.
     */
    const flushStreaming = () => {
      const stream = activeStreamsRef.current.get(streamId);
      if (stream) {
        updateStreamState(streamId, {
          streamingContent: stream.streamingBuffer,
          flushTimer: null,
        });
      }
    };

    try {
      // Build request body
      const requestBody: Record<string, unknown> = {
        prompt: message,
        useGitHubTools,
        conversationId: streamId,
        learningMode,
      };

      // Add repos if provided
      if (repos && repos.length > 0) {
        requestBody.repos = repos.map((r) => r.fullName);
      }

      // Stream response
      const res = await fetch('/api/copilot/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to get response');
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // Process SSE stream
      let errorFromStream: Error | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);

              if (event.type === 'delta') {
                // Stream text as it arrives
                responseContent += event.content;
                const stream = activeStreamsRef.current.get(streamId);
                if (stream) {
                  stream.streamingBuffer = responseContent;
                  if (clientFirstTokenMs === undefined) {
                    clientFirstTokenMs = Math.round(performance.now() - startTime);
                  }
                  if (stream.flushTimer === null) {
                    stream.flushTimer = window.setTimeout(flushStreaming, STREAMING_FLUSH_INTERVAL);
                  }
                }
              } else if (event.type === 'tool_start') {
                toolCalls.push({ name: event.name, args: event.args, result: '' });
              } else if (event.type === 'tool_complete') {
                const tc = toolCalls.find((t) => t.name === event.name && !t.result);
                if (tc) {
                  tc.result = event.result;
                  tc.duration = event.duration;
                }
              } else if (event.type === 'meta') {
                serverMeta = {
                  totalMs: event.totalMs,
                  firstDeltaMs: event.firstDeltaMs,
                  sessionCreateMs: event.sessionCreateMs,
                  sessionPoolHit: event.sessionPoolHit,
                  mcpEnabled: event.mcpEnabled,
                  sessionReused: event.sessionReused,
                  model: event.model,
                  activityEventId: event.activityEventId,
                };
                activityEventId = event.activityEventId;
                // Check for actionable item flag from server
                if (event.hasActionableItem) {
                  hasActionableItem = true;
                }
              } else if (event.type === 'done') {
                responseContent = event.totalContent;
                if (event.hasActionableItem) {
                  hasActionableItem = true;
                }
              } else if (event.type === 'error') {
                // Mark error for throwing after stream processing
                errorFromStream = new Error(event.message);
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }

        // Throw error after processing the line
        if (errorFromStream) {
          throw errorFromStream;
        }
      }

      // Finalize streaming
      const clientTotalMs = Math.round(performance.now() - startTime);
      const stream = activeStreamsRef.current.get(streamId);
      if (stream && stream.flushTimer !== null) {
        window.clearTimeout(stream.flushTimer);
        flushStreaming();
      }

      // Update activity log with client-side metrics (single source of truth for UI)
      if (activityEventId && clientFirstTokenMs != null) {
        // Fire and forget - don't block on this
        apiPatch('/api/ai-activity/metrics', {
          eventId: activityEventId,
          clientMetrics: {
            firstTokenMs: clientFirstTokenMs,
            totalMs: clientTotalMs,
          },
        }, { throwOnError: false }).catch((err) => {
          logger.warn('Failed to update activity metrics', { err }, 'useCopilotStream');
        });
      }

      // Create assistant message
      const assistantMessage: StreamingMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: responseContent,
        timestamp: now(),
        perf: {
          clientTotalMs,
          clientFirstTokenMs,
          serverTotalMs: serverMeta?.totalMs,
          serverFirstTokenMs: serverMeta?.firstDeltaMs ?? undefined,
          sessionCreateMs: serverMeta?.sessionCreateMs ?? undefined,
          sessionPoolHit: serverMeta?.sessionPoolHit ?? undefined,
          mcpEnabled: serverMeta?.mcpEnabled ?? undefined,
          sessionReused: serverMeta?.sessionReused ?? undefined,
          model: serverMeta?.model,
        },
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        hasActionableItem,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      return assistantMessage;
    } catch (err) {
      // Handle user-initiated cancellation
      if (err instanceof Error && err.name === 'AbortError') {
        if (responseContent) {
          const partialMessage: StreamingMessage = {
            id: generateMessageId(),
            role: 'assistant',
            content: responseContent + '\n\n*(Response stopped)*',
            timestamp: now(),
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          };
          setMessages((prev) => [...prev, partialMessage]);
          return partialMessage;
        }
        return null;
      }

      // Handle error
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const errorMessage: StreamingMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: errorMsg,
        timestamp: now(),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      return errorMessage;
    } finally {
      // Clean up this stream
      removeStream(streamId);
    }
  }, [ensureConversationId, updateStreamState, removeStream]);

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
