/**
 * Types for AI Activity logging and the Activity Panel
 */

/** Types of SDK operations that can be logged */
export type AIActivityType = 'embed' | 'ask' | 'session' | 'tool' | 'error' | 'internal';

/** Status of an activity event */
export type AIActivityStatus = 'pending' | 'success' | 'error';

/** Input data for an activity event */
export interface AIActivityInput {
  /** The prompt sent to the AI (truncated for display) */
  prompt?: string;
  /** Text being embedded */
  text?: string;
  /** Name of tool being invoked */
  toolName?: string;
  /** Session ID for multi-turn conversations */
  sessionId?: string;
  /** Model used for the operation */
  model?: string;
  /** Session creation metrics */
  sessionMetrics?: {
    /** Whether the session was created new or reused from pool */
    poolHit?: boolean;
    /** Time to create session in ms (0 if pool hit) */
    sessionCreateMs?: number;
    /** Whether MCP tools were enabled */
    mcpEnabled?: boolean;
    /** Whether conversation context was reused */
    conversationReused?: boolean;
  };
  /** Client-side performance metrics (single source of truth for UI) */
  clientMetrics?: {
    /** Client-side time to first token in ms (end-to-end from user perspective) */
    firstTokenMs?: number;
    /** Client-side total time in ms (end-to-end from user perspective) */
    totalMs?: number;
  };
  /** Server-side performance metrics (for debugging/analysis) */
  serverMetrics?: {
    /** Server-side time to first token in ms (SDK processing only) */
    firstTokenMs?: number | null;
    /** Server-side total time in ms */
    totalMs?: number;
  };
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Output data from an activity event */
export interface AIActivityOutput {
  /** Response text from the AI (truncated for display) */
  text?: string;
  /** Full response text (not truncated) */
  fullResponse?: string;
  /** Embedding result info */
  embedding?: {
    dimensions: number;
  };
  /** Token usage */
  tokens?: {
    input: number;
    output: number;
  };
  /** Tool result */
  toolResult?: unknown;
  /** Tools that were used during this operation */
  toolsUsed?: string[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** A single AI activity event */
export interface AIActivityEvent {
  /** Unique identifier for this event */
  id: string;
  /** When the event occurred */
  timestamp: Date;
  /** Type of SDK operation */
  type: AIActivityType;
  /** Human-readable operation name (e.g., 'copilot.embed()') */
  operation: string;
  /** Input data for the operation */
  input?: AIActivityInput;
  /** Output data from the operation */
  output?: AIActivityOutput;
  /** How long the operation took in milliseconds */
  latencyMs: number;
  /** Current status of the operation */
  status: AIActivityStatus;
  /** Error message if status is 'error' */
  error?: string;
}

/** Listener function for activity events */
export type ActivityListener = (event: AIActivityEvent) => void;

/** Statistics about activity events */
export interface AIActivityStats {
  /** Total number of events */
  total: number;
  /** Average latency in milliseconds */
  avgLatency: number;
  /** Total tokens used (input + output) */
  totalTokens: number;
  /** Count by event type */
  byType: Record<AIActivityType, number>;
}
