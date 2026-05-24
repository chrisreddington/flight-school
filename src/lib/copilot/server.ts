import { resolveProfile, type ChatProfileId } from './profiles';
import { createSessionWithMetrics } from './sessions';
import { wrapSessionWithLogging } from './logged-session';
import type { SessionIdentity } from './session-identity';

export { wrapSessionWithLogging } from './logged-session';

type LoggedSingleTurnSessionOptions = {
  identity: SessionIdentity;
  operationName: string;
  inputPrompt: string;
  profile: ChatProfileId;
};

async function createLoggedSingleTurnSession({
  identity,
  operationName,
  inputPrompt,
  profile,
}: LoggedSingleTurnSessionOptions): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const resolved = resolveProfile(profile, { prompt: inputPrompt });
  const { session, metrics } = await createSessionWithMetrics({
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    systemMessage: resolved.systemMessage,
    model: resolved.model,
  });
  return wrapSessionWithLogging(
    identity.userId,
    session,
    operationName,
    inputPrompt,
    resolved.model,
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
    profile: 'coach',
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
    profile: 'coach-lightweight',
  });
}
