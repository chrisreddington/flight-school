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
 * Configuration options for creating a Copilot session.
 *
 * @remarks
 * Multi-tenant invariant: both `userId` and `gitHubToken` are REQUIRED. They
 * partition the session cache and bind the underlying SDK session to the
 * caller's GitHub identity. Defaulting either field would let sessions leak
 * between users sharing a sticky-routed process — see {@link getConversationSession}.
 *
 * Profile invariant: callers MUST resolve a `BaseProfileId` via
 * `resolveProfile(profileId, { prompt })` and pass the resolved profile id,
 * the composed `systemMessage`, and the resolved `capabilities` set through
 * this options bag. The session cache key extends with the profile id and a
 * stable capability fingerprint so two surfaces with different capability
 * surfaces never collide.
 *
 * NOTE: This type is consumed from Web/API code (route handlers, hooks) and
 * MUST stay free of `@github/copilot-sdk` type imports. `CapabilitySelection`
 * and `BaseProfileId` are pure value/type modules.
 */
export interface SessionOptions {
  /**
   * GitHub user ID. Partitions the in-memory session cache so two identities
   * sharing a `conversationId` never share a session entry. Also powers the
   * per-user sticky-negative entitlement cache (P5).
   *
   * Required (multi-tenant invariant — see file-level remarks).
   */
  userId: string;
  /**
   * GitHub user-to-server token (`ghu_...`) bound to the SDK session and
   * forwarded to MCP. Must come from the current request's `UserContext`,
   * never from a process-wide env var or the ambient `gh` CLI.
   *
   * Required (multi-tenant invariant — see file-level remarks).
   */
  gitHubToken: string;
  /** Resolved chat profile id. See `@/lib/copilot/profiles`. */
  profile: import('./profile-types').BaseProfileId;
  /**
   * Already-resolved capability selections (from `resolveProfile`). The
   * cache key includes a stable fingerprint of this set, so callers MUST
   * pass the same shape across turns of the same conversation.
   */
  capabilities: readonly import('./capabilities').CapabilitySelection[];
  /**
   * Precomputed capability fingerprint (from `resolveProfile`). Optional
   * — when supplied, the session factory and cache layer skip a
   * recomputation. The fingerprint MUST match
   * `composeCapabilityFingerprint(capabilities, effectiveSystemMessage)`
   * (capabilities surface AND a hash of the composed system message);
   * omitting the system-message hash silently breaks the
   * equal-fingerprint-equals-effective-prompt cache invariant.
   */
  capabilityFingerprint?: string;
  /**
   * Mirror of `resolved.requestedCapabilities` for telemetry. Logged on
   * the session-create span; not part of the cache key.
   */
  requestedCapabilities?: import('./profile-types').CapabilitiesArg | 'default';
  /** Mirror of `resolved.wasAutoElevated` for telemetry. */
  wasAutoElevated?: boolean;
  /**
   * Composed system message (typically `resolved.systemMessage`). Optional
   * for surfaces that prefer to layer the prompt directly on the user
   * message.
   */
  systemMessage?: string;
  /** Model override (defaults to the profile's resolved model). */
  model?: string;
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
  /** Challenge type: 'implement' = write from scratch, 'debug' = fix broken code */
  type?: 'implement' | 'debug';
  /** Pre-populated broken code for debug challenges (only used when type === 'debug') */
  brokenCode?: string;
  /** Programming language for the challenge */
  language: string;
  /** Difficulty level */
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** Human-readable time estimate (e.g. "30 minutes"), shown in the header meta band */
  estimatedTime?: string;
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
