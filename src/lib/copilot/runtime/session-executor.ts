import { now } from '@/lib/utils/date-utils';
import type { LoggedCopilotSession } from '@/lib/copilot/logged-session';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from '@/lib/copilot/execution/types';
import { resolveProfile, type ResolvedProfile } from '@/lib/copilot/profiles';

export type RuntimeSessionFactory = (
  request: CopilotChatExecutionRequest,
  resolved: ResolvedProfile,
) => Promise<LoggedCopilotSession>;

export async function executeChatWithSessionFactory(
  request: CopilotChatExecutionRequest,
  createChatSession: RuntimeSessionFactory,
): Promise<CopilotChatExecutionResult> {
  const resolved = resolveProfile(request.profile, {
    prompt: request.prompt,
    capabilities: request.capabilities,
  });
  const loggedSession = await createChatSession(request, resolved);

  try {
    const result = await loggedSession.sendAndWait(request.prompt);
    return {
      response: result.responseText,
      toolCalls: result.toolCalls.map((toolCall) => ({
        name: toolCall.name,
        args: toolCall.args,
        result: toolCall.result,
        duration: toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined,
      })),
      meta: {
        generatedAt: now(),
        model: loggedSession.model,
        toolsUsed: result.toolCalls.map((toolCall) => toolCall.name),
        totalTimeMs: result.totalTimeMs,
        profile: request.profile,
        sessionCreateMs: loggedSession.sessionMetrics?.sessionCreateMs ?? null,
        sessionPoolHit: loggedSession.sessionMetrics ? !loggedSession.sessionMetrics.createdNew : null,
        mcpEnabled: loggedSession.sessionMetrics?.mcpEnabled ?? null,
        sessionReused: loggedSession.sessionMetrics?.reusedConversation ?? null,
      },
    };
  } finally {
    loggedSession.destroy();
  }
}
