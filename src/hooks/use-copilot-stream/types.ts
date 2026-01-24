/**
 * useCopilotStream Types
 *
 * Type definitions for the Copilot streaming hook.
 * Extracted to reduce main hook file size and improve maintainability.
 */

import type { RepoReference } from '@/lib/threads';
import type { StreamState as GlobalStreamState } from '@/lib/stream-store/types';

// ============================================================================
// Message Types
// ============================================================================

/** Tool call during a chat message */
export interface ToolCall {
  /** Tool name (e.g., 'get_file_contents') */
  name: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Tool result (empty until complete) */
  result: string;
  /** Duration in milliseconds */
  duration?: number;
}

/** Performance metrics for a message */
export interface MessagePerformance {
  /** Client-side total time in ms */
  clientTotalMs?: number;
  /** Client-side time to first token in ms */
  clientFirstTokenMs?: number;
  /** Server-side total time in ms */
  serverTotalMs?: number;
  /** Server-side time to first token in ms */
  serverFirstTokenMs?: number | null;
  /** Session creation time in ms */
  sessionCreateMs?: number | null;
  /** Whether a session pool hit occurred */
  sessionPoolHit?: boolean | null;
  /** Whether MCP tools were enabled */
  mcpEnabled?: boolean | null;
  /** Whether the session was reused */
  sessionReused?: boolean | null;
  /** Model used */
  model?: string;
}

/** Extended message type for streaming chat */
export interface StreamingMessage {
  /** Message ID */
  id: string;
  /** Role: user or assistant */
  role: 'user' | 'assistant';
  /** Message content */
  content: string;
  /** Timestamp */
  timestamp: string;
  /** Whether this is an error message */
  isError?: boolean;
  /** Performance metrics */
  perf?: MessagePerformance;
  /** Tool calls made during response */
  toolCalls?: ToolCall[];
  /** Whether the message contains an actionable item */
  hasActionableItem?: boolean;
}

// ============================================================================
// Options Types
// ============================================================================

/** Options for sending a message */
export interface SendMessageOptions {
  /** Enable GitHub MCP tools */
  useGitHubTools?: boolean;
  /** Repositories to scope the context to */
  repos?: RepoReference[];
  /** Conversation ID for multi-turn chat */
  conversationId?: string;
  /** Enable learning mode (reasoning, follow-ups) */
  learningMode?: boolean;
  /**
   * Callback invoked when stream completes (runs outside React lifecycle).
   * Use this for critical persistence operations that must succeed even if
   * the component unmounts during streaming.
   */
  onComplete?: (state: GlobalStreamState) => void | Promise<void>;
}

// ============================================================================
// Stream State Types
// ============================================================================

/** Per-stream state for tracking multiple concurrent streams */
export interface StreamState {
  /** Whether this stream is currently loading */
  isLoading: boolean;
  /** Current streaming content for this stream */
  streamingContent: string;
  /** Abort controller for this stream */
  abortController: AbortController | null;
  /** Streaming buffer ref */
  streamingBuffer: string;
  /** Streaming flush timer */
  flushTimer: number | null;
}

// ============================================================================
// Hook Return Types
// ============================================================================

/** State returned by the useCopilotStream hook */
export interface UseCopilotStreamState {
  /** All messages in the conversation */
  messages: StreamingMessage[];
  /** Whether a message is currently being processed (any stream) */
  isLoading: boolean;
  /** Current streaming content (partial response) - for the active stream */
  streamingContent: string;
  /** Current conversation ID */
  conversationId: string | null;
  /** Map of active streams by conversation ID */
  activeStreams: Map<string, StreamState>;
}

/** Actions provided by the useCopilotStream hook */
export interface UseCopilotStreamActions {
  /** Send a message and stream the response */
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<StreamingMessage | null>;
  /** Stop the streaming response for a specific conversation (or current if not specified) */
  stopStreaming: (conversationId?: string) => void;
  /** Clear all messages */
  clearMessages: () => void;
  /** Reset conversation (clear messages and ID) */
  resetConversation: () => void;
  /** Set messages externally (e.g., when loading a thread) */
  setMessages: (messages: StreamingMessage[]) => void;
  /** Check if a specific conversation is streaming */
  isStreamingConversation: (conversationId: string) => boolean;
  /** Get streaming content for a specific conversation */
  getStreamingContent: (conversationId: string) => string;
}

/** Return type of the useCopilotStream hook */
export type UseCopilotStreamReturn = UseCopilotStreamState & UseCopilotStreamActions;
