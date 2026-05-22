import { createLoggedChatSession, createLoggedGitHubChatSession } from '@/lib/copilot/server';
import { now } from '@/lib/utils/date-utils';
import { needsGitHubTools } from '@/lib/utils/content-detection';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';

export async function executeCopilotChat({
  identity,
  prompt,
  useGitHubTools,
  conversationId,
}: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult> {
  const enableGitHub = useGitHubTools === true || needsGitHubTools(prompt);
  const sessionType = enableGitHub ? 'GitHub Chat' : 'Chat (fast)';
  const loggedSession = enableGitHub
    ? await createLoggedGitHubChatSession(identity, sessionType, prompt, conversationId)
    : await createLoggedChatSession(identity, sessionType, prompt, conversationId);

  try {
    const result = await loggedSession.sendAndWait(prompt);
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
