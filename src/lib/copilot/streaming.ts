/**
 * Copilot SDK Streaming Support
 *
 * Public factories for real-time chat/learning/evaluation responses. Each
 * factory selects a system prompt + pool key prefix and delegates to
 * `createGenericStreamingSession`, which owns the SDK plumbing and telemetry.
 *
 * @see createStreamingChatSession for basic chat streaming
 * @see createLearningStreamingSession for educational responses
 * @see createEvaluationStreamingSession for challenge evaluation
 */

import { createGenericStreamingSession } from './streaming-session';
import type { StreamingSession } from './types';

/**
 * Learning lens system prompt for educational chat sessions.
 *
 * Implements the learning-focused response pattern from copilot-instructions.md:
 * step-by-step reasoning, follow-up suggestions, and references to the user's
 * code when relevant.
 *
 * @see SPEC-001 AC3.1, AC3.2
 */
const LEARNING_LENS_SYSTEM_PROMPT = `You are a developer learning companion.

When responding:
1. Explain your reasoning step-by-step
2. Suggest 2-3 follow-up questions or experiments
3. Reference the user's code when relevant
4. Be conversational but focused

If user wants a quick answer, skip the explanations.`;

/**
 * Create a streaming chat session that yields events as they arrive.
 *
 * @param identity - per-request `{ userId, gitHubToken }` from `requireUserContext`
 * @param prompt - The user's message
 * @param useGitHubTools - Whether to include MCP GitHub tools
 * @param operationName - Name for activity logging
 * @param conversationId - Optional conversation ID for session reuse
 *
 * @example
 * ```typescript
 * const { stream, cleanup } = await createStreamingChatSession(identity, "hello", false);
 * for await (const event of stream) {
 *   if (event.type === 'delta') process.stdout.write(event.content);
 *   if (event.type === 'done') break;
 * }
 * cleanup();
 * ```
 */
export async function createStreamingChatSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  useGitHubTools: boolean,
  operationName = 'Chat',
  conversationId?: string,
): Promise<StreamingSession> {
  const systemMessage = useGitHubTools
    ? `You are a helpful developer assistant with access to GitHub tools.
Be conversational, helpful, and concise. Reference specific repos when relevant.`
    : `You are a helpful developer assistant.

Be conversational, helpful, and concise. Mention GitHub tools only when asked.`;

  return createGenericStreamingSession({
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage,
    poolKeyPrefix: 'chat',
    logPrefix: 'Copilot Streaming',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}

/**
 * Create a learning-focused streaming chat session. Uses the
 * `LEARNING_LENS_SYSTEM_PROMPT` so responses explain reasoning, suggest
 * follow-ups, and connect to the user's context.
 *
 * @see SPEC-001 for learning chat requirements (AC3.1, AC3.2)
 */
export async function createLearningStreamingSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  useGitHubTools: boolean,
  operationName = 'Learning Chat',
  conversationId?: string,
): Promise<StreamingSession> {
  // When GitHub tools are available we extend the prompt so the AI prefers MCP
  // over guessing or local shell/filesystem fallbacks.
  const systemMessage = useGitHubTools
    ? `${LEARNING_LENS_SYSTEM_PROMPT}

You have access to GitHub MCP tools. When the user asks about repositories, use those tools to explore them — search code, read files, and get repo details.
Never use local shell/filesystem/web tools for repository questions.
Always use GitHub tools to look up real information rather than guessing.`
    : LEARNING_LENS_SYSTEM_PROMPT;

  return createGenericStreamingSession({
    prompt,
    useGitHubTools,
    operationName,
    conversationId,
    systemMessage,
    poolKeyPrefix: 'learning',
    logPrefix: 'Copilot Learning',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}

/**
 * Create a streaming evaluation session for challenge solutions. Each
 * evaluation is independent (no conversation reuse) and never needs GitHub
 * tools.
 *
 * @see SPEC-002 for challenge evaluation requirements
 */
export async function createEvaluationStreamingSession(
  identity: { userId: string; gitHubToken: string },
  prompt: string,
  systemMessage: string,
  operationName = 'Challenge Evaluation',
): Promise<StreamingSession> {
  return createGenericStreamingSession({
    prompt,
    useGitHubTools: false,
    operationName,
    conversationId: undefined,
    systemMessage,
    poolKeyPrefix: 'evaluation',
    logPrefix: 'Copilot Evaluation',
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
  });
}
