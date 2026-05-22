export interface CopilotRuntime {
  userId: string;
  disconnect: () => Promise<void> | void;
}

export interface CopilotRuntimePool {
  getRuntime: (userId: string) => Promise<CopilotRuntime>;
  evictRuntime: (userId: string) => Promise<void>;
  shutdown: () => Promise<void>;
}

type CopilotRuntimeLifecycleEvent =
  | { type: 'created'; userId: string }
  | { type: 'reused'; userId: string }
  | { type: 'evicted'; userId: string; reason: 'capacity' | 'idle' | 'manual' | 'shutdown' };

export interface CreatePerUserRuntimePoolOptions {
  createRuntime: (userId: string) => Promise<CopilotRuntime>;
  idleTtlMs: number;
  maxActiveRuntimes: number;
  now?: () => number;
  onEvent?: (event: CopilotRuntimeLifecycleEvent) => void;
}
