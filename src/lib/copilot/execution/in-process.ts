import { createLoggedChatSession, createLoggedGitHubChatSession } from '@/lib/copilot/server';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';
import { executeChatWithSessionFactory } from '@/lib/copilot/runtime/session-executor';

export async function executeCopilotChatInProcess(
  request: CopilotChatExecutionRequest,
): Promise<CopilotChatExecutionResult> {
  return executeChatWithSessionFactory(
    request,
    ({ identity, prompt, conversationId }, operationName) =>
      createLoggedChatSession(identity, operationName, prompt, conversationId),
    ({ identity, prompt, conversationId }, operationName) =>
      createLoggedGitHubChatSession(identity, operationName, prompt, conversationId),
  );
}
