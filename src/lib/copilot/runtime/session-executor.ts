import { now } from '@/lib/utils/date-utils';
import type { LoggedCopilotSession } from '@/lib/copilot/logged-session';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from '@/lib/copilot/execution/types';
import {
  getConversationCapabilities,
  rememberConversationCapabilities,
} from '@/lib/copilot/conversation-capabilities';
import { resolveProfile, type ResolvedProfile } from '@/lib/copilot/profiles';

export type RuntimeSessionFactory = (
  request: CopilotChatExecutionRequest,
  resolved: ResolvedProfile,
) => Promise<LoggedCopilotSession>;

export async function executeChatWithSessionFactory(
  request: CopilotChatExecutionRequest,
  createChatSession: RuntimeSessionFactory,
): Promise<CopilotChatExecutionResult> {
  // Fold in carried conversation capabilities so multi-turn `auto`
  // requests on the direct worker path stay monotonic-add — matches
  // the streaming chat factory's behaviour (see `streaming.ts`).
  const resolved = resolveProfile(request.profile, {
    prompt: request.prompt,
    capabilities: request.capabilities,
    conversationCapabilities: getConversationCapabilities(
      request.identity.userId,
      request.conversationId,
    ),
  });
  const loggedSession = await createChatSession(request, resolved);

  try {
    const result = await loggedSession.sendAndWait(request.prompt);
    if (request.conversationId) {
      rememberConversationCapabilities(
        request.identity.userId,
        request.conversationId,
        resolved.capabilities.map((selection) => selection.id),
      );
    }
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
