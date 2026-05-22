import { getCopilotWorkerConfig } from './config';
import { executeCopilotChatViaWorker } from './http-client';
import { executeCopilotChatInProcess } from './in-process';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';

export async function executeCopilotChat(
  request: CopilotChatExecutionRequest,
): Promise<CopilotChatExecutionResult> {
  const workerConfig = getCopilotWorkerConfig();
  if (workerConfig) {
    return executeCopilotChatViaWorker(workerConfig, request);
  }
  return executeCopilotChatInProcess(request);
}
