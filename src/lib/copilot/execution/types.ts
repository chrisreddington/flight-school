import type { BaseProfileId, CapabilitiesArg } from '@/lib/copilot/profile-types';
import type { SessionIdentity } from '@/lib/copilot/session-identity';

export interface CopilotChatExecutionRequest {
  identity: SessionIdentity;
  prompt: string;
  profile: BaseProfileId;
  /**
   * Caller-supplied capability selection from the wire. The worker
   * resolves this against the profile's allowed list and defaults; the
   * caller never gets authority to bypass profile policy. Omitted =
   * profile defaults.
   */
  capabilities?: CapabilitiesArg;
  conversationId?: string;
}

export interface CopilotToolCallRecord {
  name: string;
  args: unknown;
  result: string;
  duration?: number;
}

export interface CopilotChatExecutionResult {
  response: string;
  toolCalls: CopilotToolCallRecord[];
  meta: {
    generatedAt: string;
    model: string;
    toolsUsed: string[];
    totalTimeMs: number;
    profile: BaseProfileId;
    sessionCreateMs: number | null;
    sessionPoolHit: boolean | null;
    mcpEnabled: boolean | null;
    sessionReused: boolean | null;
  };
}

/**
 * `lightweight` selects the no-MCP fast model used by quiz/hint/suggestions/
 * focus generation. `coach` adds GitHub MCP tools and the standard model.
 */
export type CopilotCoachVariant = 'lightweight' | 'coach';

export interface CopilotCoachJobRequest {
  identity: SessionIdentity;
  variant: CopilotCoachVariant;
  operationName: string;
  prompt: string;
  /**
   * Caller-friendly label echoed in telemetry. Independent of `prompt` so
   * the worker can log a short topic without persisting the full input.
   */
  inputSummary?: string;
}

export interface CopilotCoachJobResult {
  response: string;
  toolCalls: CopilotToolCallRecord[];
  meta: {
    generatedAt: string;
    model: string;
    operationName: string;
    variant: CopilotCoachVariant;
    totalTimeMs: number;
    sessionCreateMs: number | null;
    mcpEnabled: boolean;
  };
}
