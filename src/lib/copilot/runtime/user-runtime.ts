import { approveAll, CopilotClient } from '@github/copilot-sdk';
import type { CopilotSession, PermissionHandler } from '@github/copilot-sdk';

import { buildMcpServersForCapabilities } from '@/lib/copilot/capabilities';
import { wrapSessionWithLogging } from '@/lib/copilot/logged-session';
import type { SessionCreationMetrics } from '@/lib/copilot/types';
import type { CopilotChatExecutionRequest } from '@/lib/copilot/execution/types';
import type { ResolvedProfile } from '@/lib/copilot/profiles';
import { executeChatWithSessionFactory } from './session-executor';
import { executeCoachJobInRuntime } from './coach-executor';
import type { CopilotRuntime } from './types';

const mcpOnlyPermissionHandler: PermissionHandler = (request) => {
  if (request.kind === 'mcp') {
    return { kind: 'approve-once' };
  }
  return { kind: 'reject', feedback: 'MCP tools only for this session.' };
};

export interface CreateCopilotUserRuntimeOptions {
  userId: string;
  gitHubToken: string;
  copilotHome: string;
}

export async function createCopilotUserRuntime({
  userId,
  gitHubToken,
  copilotHome,
}: CreateCopilotUserRuntimeOptions): Promise<CopilotRuntime> {
  const client = new CopilotClient({
    gitHubToken,
    useLoggedInUser: false,
    copilotHome,
  });

  return {
    userId,
    copilotHome,
    executeChat: (request) =>
      executeChatWithSessionFactory(request, (chatRequest, resolved) =>
        createRuntimeLoggedSession(client, chatRequest, resolved),
      ),
    executeCoachJob: (request) => executeCoachJobInRuntime(request),
    async disconnect() {
      const errors = await client.stop();
      if (errors.length > 0) {
        await client.forceStop();
      }
    },
  };
}

async function createRuntimeLoggedSession(
  client: CopilotClient,
  request: CopilotChatExecutionRequest,
  resolved: ResolvedProfile,
) {
  const startTime = Date.now();
  const session = await createRuntimeSession(client, request, resolved);
  const sessionCreateMs = Date.now() - startTime;
  return wrapSessionWithLogging(
    request.identity.userId,
    session,
    `Worker ${resolved.profileId}`,
    request.prompt,
    resolved.model,
    undefined,
    createRuntimeSessionMetrics(resolved, sessionCreateMs),
  );
}

async function createRuntimeSession(
  client: CopilotClient,
  request: CopilotChatExecutionRequest,
  resolved: ResolvedProfile,
): Promise<CopilotSession> {
  const mcpServers = buildMcpServersForCapabilities(
    resolved.capabilities,
    request.identity.gitHubToken,
  );
  const hasMcp = Object.keys(mcpServers).length > 0;

  return client.createSession({
    model: resolved.model,
    streaming: true,
    onPermissionRequest: hasMcp ? mcpOnlyPermissionHandler : approveAll,
    gitHubToken: request.identity.gitHubToken,
    excludedTools: [
      'shell',
      'editFile',
      'createFile',
      'deleteFile',
      'runCommand',
      'bash',
      'terminal',
      'web_fetch',
      'web_search',
      'task',
      'view',
      'glob',
      'rg',
      'grep',
      'read_bash',
      'write_bash',
      'list_bash',
      'stop_bash',
      'gh',
      'curl',
    ],
    ...(hasMcp ? { mcpServers } : {}),
    systemMessage: {
      mode: 'append',
      content: resolved.systemMessage,
    },
  });
}

function createRuntimeSessionMetrics(
  resolved: ResolvedProfile,
  sessionCreateMs: number,
): SessionCreationMetrics {
  return {
    poolKey: `worker:${resolved.profileId}:${resolved.capabilityFingerprint}`,
    createdNew: true,
    sessionCreateMs,
    mcpEnabled: resolved.capabilities.length > 0,
    model: resolved.model,
    reusedConversation: false,
  };
}
