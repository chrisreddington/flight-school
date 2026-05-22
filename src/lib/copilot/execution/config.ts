const DEFAULT_WORKER_TIMEOUT_MS = 120_000;

export interface CopilotWorkerConfig {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
}

interface CopilotWorkerEnv {
  [key: string]: string | undefined;
  COPILOT_WORKER_URL?: string;
  COPILOT_WORKER_SECRET?: string;
  COPILOT_WORKER_TIMEOUT_MS?: string;
}

export function getCopilotWorkerConfig(env: CopilotWorkerEnv = process.env): CopilotWorkerConfig | null {
  const rawUrl = env.COPILOT_WORKER_URL?.trim();
  if (!rawUrl) return null;

  const secret = env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    throw new Error('COPILOT_WORKER_SECRET is required when COPILOT_WORKER_URL is set');
  }

  return {
    baseUrl: rawUrl.replace(/\/+$/, ''),
    secret,
    timeoutMs: parseWorkerTimeout(env.COPILOT_WORKER_TIMEOUT_MS),
  };
}

function parseWorkerTimeout(rawTimeout?: string): number {
  if (!rawTimeout?.trim()) return DEFAULT_WORKER_TIMEOUT_MS;

  const timeoutMs = Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('COPILOT_WORKER_TIMEOUT_MS must be a positive integer');
  }
  return timeoutMs;
}
