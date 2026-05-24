import { approveAll, CopilotClient } from '@github/copilot-sdk';
import type { CopilotSession, PermissionHandler } from '@github/copilot-sdk';

import { getCopilotGithubMcpTools } from '@/lib/copilot/mcp-tools';
import { getMcpServerConfig } from '@/lib/copilot/mcp';
import {
  CHAT_MODEL,
} from '@/lib/copilot/sessions';
import { CHAT_SYSTEM_PROMPT, GITHUB_CHAT_SYSTEM_PROMPT } from '@/lib/copilot/prompts';
import { wrapSessionWithLogging } from '@/lib/copilot/logged-session';
import type { SessionCreationMetrics } from '@/lib/copilot/types';
import type { CopilotChatExecutionRequest } from '@/lib/copilot/execution/types';
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
    executeChat: (request) => executeChatWithSessionFactory(
      request,
      (chatRequest, operationName) => createRuntimeLoggedSession(client, chatRequest, operationName, false),
      (chatRequest, operationName) => createRuntimeLoggedSession(client, chatRequest, operationName, true),
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
  operationName: string,
  includeMcp: boolean,
) {
  const startTime = Date.now();
  const session = await createRuntimeSession(client, request, includeMcp);
  const sessionCreateMs = Date.now() - startTime;
  return wrapSessionWithLogging(
    request.identity.userId,
    session,
    operationName,
    request.prompt,
    CHAT_MODEL,
    undefined,
    createRuntimeSessionMetrics(operationName, sessionCreateMs, includeMcp),
  );
}

async function createRuntimeSession(
  client: CopilotClient,
  request: CopilotChatExecutionRequest,
  includeMcp: boolean,
): Promise<CopilotSession> {
  const chatTools = includeMcp ? getCopilotGithubMcpTools() : null;
  const mcpConfig = includeMcp
    ? getMcpServerConfig({ token: request.identity.gitHubToken, tools: chatTools ?? undefined })
    : null;

  return client.createSession({
    model: CHAT_MODEL,
    streaming: true,
    onPermissionRequest: includeMcp ? mcpOnlyPermissionHandler : approveAll,
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
    ...(mcpConfig && { mcpServers: { github: mcpConfig } }),
    systemMessage: {
      mode: 'append',
      content: includeMcp ? GITHUB_CHAT_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
    },
  });
}

function createRuntimeSessionMetrics(
  operationName: string,
  sessionCreateMs: number,
  mcpEnabled: boolean,
): SessionCreationMetrics {
  return {
    poolKey: operationName === 'GitHub Chat' ? 'worker:chat:mcp' : 'worker:chat:lightweight',
    createdNew: true,
    sessionCreateMs,
    mcpEnabled,
    model: CHAT_MODEL,
    reusedConversation: false,
  };
}
