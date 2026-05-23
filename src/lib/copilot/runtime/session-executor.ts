import { now } from '@/lib/utils/date-utils';
import { needsGitHubTools } from '@/lib/utils/content-detection';
import type { LoggedCopilotSession } from '@/lib/copilot/logged-session';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from '@/lib/copilot/execution/types';

export type RuntimeSessionFactory = (
  request: CopilotChatExecutionRequest,
  operationName: string,
) => Promise<LoggedCopilotSession>;

export async function executeChatWithSessionFactory(
  request: CopilotChatExecutionRequest,
  createChatSession: RuntimeSessionFactory,
  createGitHubChatSession: RuntimeSessionFactory,
): Promise<CopilotChatExecutionResult> {
  const enableGitHub = request.useGitHubTools === true || needsGitHubTools(request.prompt);
  const sessionType = enableGitHub ? 'GitHub Chat' : 'Chat (fast)';
  const loggedSession = enableGitHub
    ? await createGitHubChatSession(request, sessionType)
    : await createChatSession(request, sessionType);

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
        usedGitHubTools: enableGitHub,
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
