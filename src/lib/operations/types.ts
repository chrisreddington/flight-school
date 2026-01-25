/**
 * Types for Active Operations Manager
 *
 * The operations manager tracks long-running AI operations that should
 * continue even when the initiating React component unmounts.
 */

/** Types of operations that can be tracked */
export type OperationType =
  | 'topic-regeneration'
  | 'challenge-regeneration'
  | 'goal-regeneration'
  | 'chat-message'
  | 'chat-response';

/** Status of an operation */
export type OperationStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'aborted';

/** Status of a persisted operation state stored in item files. */
export type OperationStateStatus = 'generating' | 'complete' | 'failed';

/**
 * Operation state persisted alongside item content for recovery.
 */
export interface OperationState {
  /** Backend job identifier. */
  jobId: string;
  /** Current persisted status. */
  status: OperationStateStatus;
  /** ISO timestamp when the operation started. */
  startedAt: string;
}

/** Metadata for an operation */
export interface OperationMeta {
  /** The type of operation */
  type: OperationType;
  /** When the operation started */
  startedAt: string;
  /** Human-readable description */
  description?: string;
  /** ID of the item being regenerated (topic ID, challenge ID, etc.) */
  targetId?: string;
  /** Additional context data */
  context?: Record<string, unknown>;
  /** Backend job ID (for background jobs) */
  jobId?: string;
}

/** A tracked operation */
export interface ActiveOperation<T = unknown> {
  /** Unique identifier for this operation */
  id: string;
  /** Current status */
  status: OperationStatus;
  /** Operation metadata */
  meta: OperationMeta;
  /** Result data (only set when status is 'complete') */
  result?: T;
  /** Error message (only set when status is 'failed') */
  error?: string;
  /** AbortController for cancellation */
  abortController?: AbortController;
}

/** Options for starting an operation */
export interface StartOperationOptions<T> {
  /** Unique ID for this operation (e.g., topic ID being regenerated) */
  id: string;
  /** Type of operation */
  type: OperationType;
  /** Human-readable description */
  description?: string;
  /** ID of the target item */
  targetId?: string;
  /** The async function to execute */
  executor: (signal: AbortSignal) => Promise<T>;
  /** Callback when operation completes successfully */
  onComplete?: (result: T) => void | Promise<void>;
  /** Callback when operation fails */
  onError?: (error: Error) => void;
  /** Additional context */
  context?: Record<string, unknown>;
}

/** Listener function signature */
export type OperationsListener = () => void;

/** Snapshot of all active operations by type */
export interface OperationsSnapshot {
  /** All operations of type 'topic-regeneration' */
  topicRegenerations: Map<string, ActiveOperation>;
  /** All operations of type 'challenge-regeneration' */
  challengeRegenerations: Map<string, ActiveOperation>;
  /** All operations of type 'goal-regeneration' */
  goalRegenerations: Map<string, ActiveOperation>;
  /** All operations of type 'chat-message' */
  chatMessages: Map<string, ActiveOperation>;
}
