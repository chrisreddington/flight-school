import type {
  CopilotChatExecutionRequest,
  CopilotChatExecutionResult,
  CopilotCoachJobRequest,
  CopilotCoachJobResult,
} from '@/lib/copilot/execution/types';

interface CopilotRuntimeCreationContext {
  gitHubToken: string;
}

export interface CopilotRuntime {
  userId: string;
  copilotHome: string;
  executeChat: (request: CopilotChatExecutionRequest) => Promise<CopilotChatExecutionResult>;
  executeCoachJob: (request: CopilotCoachJobRequest) => Promise<CopilotCoachJobResult>;
  disconnect: () => Promise<void> | void;
}

export interface CopilotRuntimePool {
  getRuntime: (userId: string, context: CopilotRuntimeCreationContext) => Promise<CopilotRuntime>;
  evictRuntime: (userId: string) => Promise<void>;
  shutdown: () => Promise<void>;
}

type CopilotRuntimeLifecycleEvent =
  | { type: 'created'; userId: string }
  | { type: 'reused'; userId: string }
  | { type: 'evicted'; userId: string; reason: 'capacity' | 'idle' | 'manual' | 'shutdown' };

export interface CreatePerUserRuntimePoolOptions {
  createRuntime: (userId: string, context: CopilotRuntimeCreationContext) => Promise<CopilotRuntime>;
  idleTtlMs: number;
  maxActiveRuntimes: number;
  now?: () => number;
  onEvent?: (event: CopilotRuntimeLifecycleEvent) => void;
}
