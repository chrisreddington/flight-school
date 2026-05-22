import { getCopilotWorkerConfig } from './config';
import { executeCopilotChatViaWorker } from './http-client';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';
import { CopilotWorkerRequiredError } from './worker-required-error';

export async function executeCopilotChat(
  request: CopilotChatExecutionRequest,
): Promise<CopilotChatExecutionResult> {
  const workerConfig = getCopilotWorkerConfig();
  if (!workerConfig) {
    throw new CopilotWorkerRequiredError();
  }
  return executeCopilotChatViaWorker(workerConfig, request);
}
