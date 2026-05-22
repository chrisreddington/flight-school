import type { SessionIdentity } from '@/lib/copilot/session-identity';

export interface CopilotChatExecutionRequest {
  identity: SessionIdentity;
  prompt: string;
  useGitHubTools?: boolean;
  conversationId?: string;
}

export interface CopilotChatExecutionResult {
  response: string;
  toolCalls: Array<{
    name: string;
    args: unknown;
    result: string;
    duration?: number;
  }>;
  meta: {
    generatedAt: string;
    model: string;
    toolsUsed: string[];
    totalTimeMs: number;
    usedGitHubTools: boolean;
    sessionCreateMs: number | null;
    sessionPoolHit: boolean | null;
    mcpEnabled: boolean | null;
    sessionReused: boolean | null;
  };
}
