/**
 * Copilot SDK Types
 *
 * Centralized type definitions for the Copilot SDK feature domain.
 * Includes types for sessions, streaming, evaluation, hints, and server utilities.
 */

// ============================================================================
// Session Types
// ============================================================================

/**
 * Metrics captured during session creation
 */
export interface SessionCreationMetrics {
  poolKey: string;
  createdNew: boolean;
  sessionCreateMs: number;
  mcpEnabled: boolean;
  model: string;
  reusedConversation: boolean;
}

/**
 * Configuration options for creating a Copilot session
 */
export interface SessionOptions {
  /** System message mode */
  systemMessage?: string;
  /** Whether to include MCP GitHub tools */
  includeMcpTools?: boolean;
  /** MCP tool allowlist (defaults to full access) */
  tools?: string[];
  /** Model override (defaults to standard) */
  model?: string;
}

/**
 * Session with its creation metrics
 */
export interface SessionWithMetrics {
  session: import('@github/copilot-sdk').CopilotSession;
  metrics: SessionCreationMetrics;
}

// ============================================================================
// Streaming Types
// ============================================================================

/**
 * Tool call record for tracking MCP tool usage during streaming
 */
export interface StreamingToolCall {
  /** Tool name (e.g., 'get_file_contents') */
  name: string;
  /** Tool arguments */
  args: unknown;
  /** Tool result (empty until complete) */
  result: string;
  /** When the tool execution started */
  startTime: number;
  /** When the tool execution completed */
  endTime?: number;
}

/**
 * Event types sent via SSE stream
 */
export type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_start'; name: string; args: unknown }
  | { type: 'tool_complete'; name: string; result: string; duration: number }
  | { type: 'done'; totalContent: string; toolCalls: StreamingToolCall[]; durationMs: number }
  | { type: 'error'; message: string };

/**
 * Stream result with async iterator for SSE.
 */
export interface StreamingSession {
  /** Async iterator yielding stream events */
  stream: AsyncGenerator<StreamEvent, void, unknown>;
  /** Clean up the session when done */
  cleanup: () => void;
  /** Model being used */
  model: string;
  /** Session creation metrics for diagnostics */
  sessionMetrics: SessionCreationMetrics;
  /** Streaming metrics collected during the run */
  streamingMetrics: {
    firstDeltaMs: number | null;
    /** Activity event ID for correlating with activity logger */
    activityEventId?: string;
  };
}

// ============================================================================
// Evaluation Types
// ============================================================================

/**
 * Challenge definition for evaluation context.
 */
export interface ChallengeDef {
  /** Challenge title */
  title: string;
  /** Full challenge description/instructions */
  description: string;
  /** Programming language for the challenge */
  language: string;
  /** Difficulty level */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Optional hints about expected solution patterns */
  expectedPatterns?: string[];
  /** Optional test cases for validation context */
  testCases?: Array<{
    input: string;
    expectedOutput: string;
    description?: string;
  }>;
}

/**
 * Result of evaluating a challenge solution.
 */
export interface EvaluationResult {
  /** Whether the solution is correct */
  isCorrect: boolean;
  /** Overall feedback message */
  feedback: string;
  /** Specific areas done well */
  strengths: string[];
  /** Specific areas to improve */
  improvements: string[];
  /** Score out of 100 (optional) */
  score?: number;
  /** Hints for next steps (without giving away solution) */
  nextSteps?: string[];
}

/**
 * Partial result used during streaming evaluation.
 * Contains metadata parsed from JSON before feedback is complete.
 */
export interface PartialEvaluationResult {
  /** Whether the solution is correct */
  isCorrect: boolean;
  /** Score out of 100 */
  score?: number;
  /** Specific areas done well */
  strengths: string[];
  /** Specific areas to improve */
  improvements: string[];
  /** Hints for next steps */
  nextSteps?: string[];
}

// ============================================================================
// Hint Types
// ============================================================================

/**
 * Result from requesting a hint.
 */
export interface HintResult {
  /** The hint text */
  hint: string;
  /** Whether this is the final hint (giving away too much) */
  isFinalHint: boolean;
  /** Related concepts to review */
  concepts?: string[];
  /** Suggested next question if stuck */
  suggestedFollowUp?: string;
}

// ============================================================================
// Server Utility Types
// ============================================================================

/**
 * Tool call record for tracking MCP tool usage
 */
export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: string;
  startTime: number;
  endTime?: number;
}

/**
 * Result from a logged SDK operation
 */
export interface LoggedSessionResult {
  /** Response text from the AI */
  responseText: string;
  /** Tools that were called during the operation */
  toolCalls: ToolCallRecord[];
  /** Total duration in milliseconds */
  totalTimeMs: number;
}
