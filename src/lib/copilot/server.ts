import { COACH_LIGHTWEIGHT_PROMPT, COACH_SYSTEM_PROMPT } from './prompts';
import { createSessionWithMetrics, MODEL_TIERS } from './sessions';
import { wrapSessionWithLogging } from './logged-session';
import type { SessionIdentity } from './session-identity';
import type { SessionOptions } from './types';

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
