/**
 * Stream Store Types
 *
 * Types for the global stream store that manages AI streams
 * independently of React component lifecycle.
 */

import type { ToolCall } from '@/hooks/use-copilot-stream/types';

/** Possible states of a stream */
export type StreamStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'aborted';

/** Server metadata from streaming response */
export interface StreamServerMeta {
  totalMs?: number;
  firstDeltaMs?: number | null;
  sessionCreateMs?: number | null;
  sessionPoolHit?: boolean | null;
  mcpEnabled?: boolean | null;
  sessionReused?: boolean | null;
  model?: string;
  activityEventId?: string;
}

/** State of a single stream */
export interface StreamState {
  /** Unique stream identifier (conversation ID, challenge ID, etc.) */
  id: string;
  /** Current status */
  status: StreamStatus;
  /** Accumulated content from the stream */
  content: string;
  /** Tool calls tracked during streaming */
  toolCalls: ToolCall[];
  /** Error message if status is 'error' */
  error?: string;
  /** Server metadata from the stream */
  serverMeta?: StreamServerMeta;
  /** Whether the response has an actionable item */
  hasActionableItem?: boolean;
  /** Timestamp when stream started */
  startedAt: number;
  /** Timestamp when stream completed/errored */
  completedAt?: number;
  /** Client-side time to first token (ms) */
  clientFirstTokenMs?: number;
  /** Internal: abort controller for cancellation */
  abortController?: AbortController;
  /** Internal: flush timer for batching updates */
  flushTimer?: ReturnType<typeof setTimeout> | null;
  /** Internal: buffer for streaming content */
  streamingBuffer?: string;
}

/** Options for starting a copilot chat stream */
export interface CopilotStreamRequest {
  /** Type of stream */
  type: 'copilot';
  /** Message content */
  prompt: string;
  /** Enable GitHub MCP tools */
  useGitHubTools?: boolean;
  /** Conversation ID (stream ID) */
  conversationId: string;
  /** Enable learning mode */
  learningMode?: boolean;
  /** Repository references */
  repos?: Array<{ fullName: string }>;
  /**
   * Callback invoked when stream completes (success, error, or abort).
   * Runs outside React lifecycle, so it persists even if component unmounts.
   * Use this for critical persistence operations like saving messages to storage.
   */
  onComplete?: (state: StreamState) => void | Promise<void>;
}

/** Options for starting a challenge evaluation stream */
export interface EvaluationStreamRequest {
  /** Type of stream */
  type: 'evaluation';
  /** Challenge definition */
  challenge: unknown;
  /** Files to evaluate */
  files: Array<{ name: string; content: string }>;
  /** Stream ID (challenge ID) */
  streamId: string;
}

/** Union of all stream request types */
export type StreamRequest = CopilotStreamRequest | EvaluationStreamRequest;

/** Callback for stream state updates */
export type StreamSubscriber = (state: StreamState) => void;

/** Stream store interface */
export interface StreamStore {
  /** Start a new stream */
  startStream(request: StreamRequest): Promise<StreamState>;
  /** Stop/abort a stream */
  stopStream(id: string): void;
  /** Get current state of a stream */
  getStream(id: string): StreamState | undefined;
  /** Check if a stream is active */
  isStreaming(id: string): boolean;
  /** Get all active stream IDs */
  getActiveStreamIds(): string[];
  /** Subscribe to stream updates */
  subscribe(id: string, callback: StreamSubscriber): () => void;
  /** Subscribe to any stream starting/stopping (for global indicators) */
  subscribeToActivity(callback: (activeIds: string[]) => void): () => void;
}
