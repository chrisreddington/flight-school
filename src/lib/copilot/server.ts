import {
    CHAT_SYSTEM_PROMPT,
    COACH_LIGHTWEIGHT_PROMPT,
    COACH_SYSTEM_PROMPT,
    GITHUB_CHAT_SYSTEM_PROMPT,
} from './prompts';
import {
    CHAT_MODEL,
    createSessionWithMetrics,
    getConversationSession,
    MODEL_TIERS,
} from './sessions';
import { wrapSessionWithLogging } from './logged-session';
import { getCopilotGithubMcpTools } from './mcp-tools';
import type { SessionIdentity } from './session-identity';
import type { SessionOptions } from './types';

export { createSessionIdentity, type SessionIdentity } from './session-identity';
export { wrapSessionWithLogging } from './logged-session';

type LoggedSingleTurnSessionOptions = {
  identity: SessionIdentity;
  operationName: string;
  inputPrompt: string;
  model: string;
  poolKey: string;
  sessionOptions: SessionOptions;
};

async function createLoggedSingleTurnSession({
  identity,
  operationName,
  inputPrompt,
  model,
  poolKey,
  sessionOptions,
}: LoggedSingleTurnSessionOptions): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await createSessionWithMetrics(sessionOptions, poolKey);
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    model,
    undefined,
    metrics,
  );
}

type LoggedConversationSessionOptions = LoggedSingleTurnSessionOptions & {
  conversationId?: string;
};

async function createLoggedConversationSession({
  identity,
  operationName,
  inputPrompt,
  model,
  poolKey,
  sessionOptions,
  conversationId,
}: LoggedConversationSessionOptions): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const { session, metrics } = await getConversationSession(
    identity.userId,
    conversationId,
    poolKey,
    sessionOptions,
  );
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    model,
    undefined,
    metrics,
    !conversationId,
  );
}

/** Create a logged coach session with GitHub MCP tools for focus generation. */
export async function createLoggedCoachSession(
  identity: SessionIdentity,
  operationName = 'Coach Session',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  return createLoggedSingleTurnSession({
    identity,
    operationName,
    inputPrompt,
    model: MODEL_TIERS.standard,
    poolKey: 'coach:mcp',
    sessionOptions: {
      includeMcpTools: true,
      tools: ['get_me', 'list_user_repositories'],
      systemMessage: COACH_SYSTEM_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  });
}

/** Create a lightweight logged coach session without MCP tools. */
export async function createLoggedLightweightCoachSession(
  identity: SessionIdentity,
  operationName = 'Coach Session (fast)',
  inputPrompt = ''
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  return createLoggedSingleTurnSession({
    identity,
    operationName,
    inputPrompt,
    model: MODEL_TIERS.fastChat,
    poolKey: 'coach:lightweight',
    sessionOptions: {
      includeMcpTools: false,
      model: MODEL_TIERS.fastChat,
      systemMessage: COACH_LIGHTWEIGHT_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  });
}

/** Create a lightweight logged chat session for multi-turn conversations. */
export async function createLoggedChatSession(
  identity: SessionIdentity,
  operationName = 'Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  return createLoggedConversationSession({
    identity,
    operationName,
    inputPrompt,
    model: CHAT_MODEL,
    poolKey: 'chat:lightweight',
    conversationId,
    sessionOptions: {
      includeMcpTools: false,
      model: CHAT_MODEL,
      systemMessage: CHAT_SYSTEM_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  });
}

/** Create a logged chat session with GitHub MCP tools enabled. */
export async function createLoggedGitHubChatSession(
  identity: SessionIdentity,
  operationName = 'GitHub Chat Session',
  inputPrompt = '',
  conversationId?: string
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const chatTools = getCopilotGithubMcpTools();
  return createLoggedConversationSession({
    identity,
    operationName,
    inputPrompt,
    model: CHAT_MODEL,
    poolKey: 'chat:mcp',
    conversationId,
    sessionOptions: {
      includeMcpTools: true,
      model: CHAT_MODEL,
      ...(chatTools && chatTools.length > 0 && { tools: chatTools }),
      systemMessage: GITHUB_CHAT_SYSTEM_PROMPT,
      userId: identity.userId,
      gitHubToken: identity.gitHubToken,
    },
  });
}
