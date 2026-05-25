import type {
  CopilotChatExecutionRequest,
  CopilotChatExecutionResult,
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
} from '@/lib/copilot/execution/types';
import { logger } from '@/lib/logger';
import { createPerUserRuntimePool } from './per-user-pool';
import { getCopilotRuntimeConfig } from './config';
import { getCopilotRuntimeHome } from './user-home';
import { createCopilotUserRuntime } from './user-runtime';

const log = logger.withTag('Copilot Runtime Pool');
const config = getCopilotRuntimeConfig();

const pool = createPerUserRuntimePool({
  createRuntime: (userId, context) =>
    createCopilotUserRuntime({
      userId,
      gitHubToken: context.gitHubToken,
      copilotHome: getCopilotRuntimeHome(config.homeRoot, userId),
    }),
  idleTtlMs: config.idleTtlMs,
  maxActiveRuntimes: config.maxActiveRuntimes,
  onEvent: (event) => log.info(`Runtime ${event.type}`, event),
});

export async function executeCopilotChatInWorkerRuntime(
  request: CopilotChatExecutionRequest,
): Promise<CopilotChatExecutionResult> {
  const runtime = await pool.getRuntime(request.identity.userId, {
    gitHubToken: request.identity.gitHubToken,
  });
  return runtime.executeChat(request);
}

export async function executeCopilotCoachJobInWorkerRuntime(
  request: CopilotCoachJobRequest,
): Promise<CopilotCoachJobResult> {
  const runtime = await pool.getRuntime(request.identity.userId, {
    gitHubToken: request.identity.gitHubToken,
  });
  return runtime.executeCoachJob(request);
}

export async function shutdownCopilotWorkerRuntimes(): Promise<void> {
  await pool.shutdown();
}
