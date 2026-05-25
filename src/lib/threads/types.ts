/**
 * Thread Types
 *
 * Type definitions for the multi-thread chat system.
 * Supports concurrent learning threads, repository context, and smart actions.
 *
 * @see SPEC-001 Multi-Thread Learning Chat Experience
 */

// =============================================================================
// Message Types
// =============================================================================

/** Role of the message author */
type MessageRole = 'user' | 'assistant' | 'system';

/**
 * Status of a single tool call in an assistant message.
 *
 * `running` is the in-flight state surfaced live to the user; `complete` is
 * the settled state once the SDK emits `tool.execution_complete`.
 */
type ToolCallStatus = 'running' | 'complete';

/**
 * Rich record of a single MCP/Copilot tool call.
 *
 * Stored on assistant messages so the UI can surface progress without relying
 * on debug mode. The shape is intentionally serialisable so it round-trips
 * through `threadStore` JSON persistence.
 */
export interface ToolCallEvent {
  /** Stable identifier so the UI can reconcile running → complete updates. */
  id: string;
  /** Tool name as emitted by the SDK (e.g. `search_code`). */
  name: string;
  /** Current execution status. */
  status: ToolCallStatus;
  /** Arguments passed to the tool, preserved for the "Show details" disclosure. */
  args?: unknown;
  /** Truncated stringified result (only present once `status === 'complete'`). */
  result?: string;
  /** Wall-clock duration in ms (only present once `status === 'complete'`). */
  durationMs?: number;
}

/**
 * A single message in a chat thread.
 *
 * Messages support tool tracking for MCP operations and smart action detection.
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;
  /** Role of the message author */
  role: MessageRole;
  /** Message content (may contain Markdown) */
  content: string;
  /** ISO timestamp of when the message was created */
  timestamp: string;
  /** Tools called during message generation (MCP tool names) — legacy summary form. */
  toolCalls?: string[];
  /**
   * Rich tool-call timeline. Populated by the job executor while the assistant
   * is responding so the chat UI can render running/complete states inline.
   */
  toolEvents?: ToolCallEvent[];
  /** Whether the message contains an actionable item (for smart actions) */
  hasActionableItem?: boolean;
  /** Performance metrics for this message */
  perf?: {
    /** Client-side total time in ms (end-to-end from user perspective) */
    clientTotalMs?: number;
    /** Client-side time to first token in ms (includes network latency) */
    clientFirstTokenMs?: number;
    /** Server-side total time in ms */
    serverTotalMs?: number;
    /** Server-side time to first token in ms (SDK processing only) */
    serverFirstTokenMs?: number;
    /** Session creation time in ms */
    sessionCreateMs?: number;
    /** Whether the session was reused from the pool */
    sessionPoolHit?: boolean;
    /** Whether MCP tools were enabled */
    mcpEnabled?: boolean;
    /** Whether the conversation session was reused */
    sessionReused?: boolean;
    /** Model used for this message */
    model?: string;
  };
}

// =============================================================================
// Thread Context Types
// =============================================================================

/**
 * Repository reference for thread context.
 */
export interface RepoReference {
  /** Repository owner (user or org) */
  owner: string;
  /** Repository name */
  name: string;
  /** Full name (owner/name) */
  fullName: string;
}

/**
 * Context attached to a thread.
 *
 * Determines which repositories MCP tools can access and provides
 * metadata for learning-focused responses.
 */
export interface ThreadContext {
  /** Repositories attached to this thread (MCP tools filtered to these) */
  repos: RepoReference[];
  /** Learning focus description (user-defined topic) */
  learningFocus?: string;
}

// =============================================================================
// Thread Types
// =============================================================================

/**
 * A chat thread containing messages and context.
 *
 * Threads support concurrent learning across different topics,
 * with repository context scoping and persistent history.
 *
 * @example
 * ```typescript
 * const thread: Thread = {
 *   id: 'abc123',
 *   title: 'Learning React Hooks',
 *   context: {
 *     repos: [{ owner: 'facebook', name: 'react', fullName: 'facebook/react' }],
 *     learningFocus: 'Understand useEffect cleanup',
 *   },
 *   messages: [],
 *   createdAt: now(),
 *   updatedAt: now(),
 * };
 * ```
 */
export interface Thread {
  /** Unique identifier for the thread */
  id: string;
  /** User-editable title for the thread */
  title: string;
  /** Context attached to this thread (repos, learning focus) */
  context: ThreadContext;
  /** Messages in this thread */
  messages: Message[];
  /** ISO timestamp of when the thread was created */
  createdAt: string;
  /** ISO timestamp of the last activity in the thread */
  updatedAt: string;
  /** Whether this thread is currently streaming a response */
  isStreaming?: boolean;
}

// =============================================================================
// Thread State Types
// =============================================================================

/**
 * Options for creating a new thread.
 */
export interface CreateThreadOptions {
  /** Initial title (defaults to "New Thread") */
  title?: string;
  /** Initial context (defaults to empty repos) */
  context?: Partial<ThreadContext>;
}
