import { resolveProfile } from './profiles';
import type { BaseProfileId, CapabilitiesArg } from './profile-types';
import { createSessionWithMetrics } from './sessions';
import { wrapSessionWithLogging } from './logged-session';
import type { SessionIdentity } from './session-identity';

export { wrapSessionWithLogging } from './logged-session';

type LoggedSingleTurnSessionOptions = {
  identity: SessionIdentity;
  operationName: string;
  inputPrompt: string;
  profile: BaseProfileId;
  capabilities?: CapabilitiesArg;
};

async function createLoggedSingleTurnSession({
  identity,
  operationName,
  inputPrompt,
  profile,
  capabilities,
}: LoggedSingleTurnSessionOptions): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  const resolved = resolveProfile(profile, { prompt: inputPrompt, capabilities });
  const { session, metrics } = await createSessionWithMetrics({
    userId: identity.userId,
    gitHubToken: identity.gitHubToken,
    profile: resolved.profileId,
    capabilities: resolved.capabilities,
    capabilityFingerprint: resolved.capabilityFingerprint,
    requestedCapabilities: resolved.requestedCapabilities,
    wasAutoElevated: resolved.wasAutoElevated,
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

/**
 * Create a logged single-turn coach session.
 *
 * Capability selection is orthogonal to the profile: pass
 * `capabilities: ['github']` (the default) for an MCP-grounded coach,
 * or `capabilities: []` for the fast lightweight path. There is no
 * separate lightweight profile — the voice is identical, only the
 * tool surface differs.
 */
export async function createLoggedCoachSession(
  identity: SessionIdentity,
  operationName = 'Coach Session',
  inputPrompt = '',
  capabilities: CapabilitiesArg = ['github'],
): Promise<ReturnType<typeof wrapSessionWithLogging>> {
  return createLoggedSingleTurnSession({
    identity,
    operationName,
    inputPrompt,
    profile: 'coach',
    capabilities,
  });
}
