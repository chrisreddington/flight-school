/**
 * Types for Active Operations Manager
 *
 * The operations manager tracks long-running AI operations that should
 * continue even when the initiating React component unmounts.
 */

/** Types of operations that can be tracked */
export type OperationType = 'topic-regeneration' | 'challenge-regeneration' | 'goal-regeneration' | 'chat-response';

/** Status of an operation */
export type OperationStatus = 'pending' | 'in-progress' | 'complete' | 'failed' | 'aborted';

/** Metadata for an operation */
interface OperationMeta {
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
  /**
   * For `chat-response` operations: the stable assistant-message id the
   * worker is filling in. Set during {@link operationsManager.initialize}
   * from the {@link JobListDTO} so the chat hook can register the
   * `chatStreamStore` record on a cold reload without waiting for a
   * delta to arrive.
   */
  assistantMessageId?: string;
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
  /** All operations of type 'chat-response' */
  chatMessages: Map<string, ActiveOperation>;
  /**
   * Whether {@link operationsManager.initialize} has completed at
   * least once for this session. Hooks gate stale-stream cleanup on
   * this so we never treat the empty pre-hydration snapshot as
   * evidence that an in-flight stream has ended.
   */
  hydrated: boolean;
}
