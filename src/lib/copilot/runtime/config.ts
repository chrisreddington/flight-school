import path from 'path';

import { getStorageRoot } from '@/lib/storage/utils';

const DEFAULT_IDLE_TTL_MS = 600_000;
const DEFAULT_MAX_ACTIVE_RUNTIMES = 3;

export interface CopilotRuntimeConfig {
  idleTtlMs: number;
  maxActiveRuntimes: number;
  homeRoot: string;
}

interface CopilotRuntimeEnv {
  [key: string]: string | undefined;
  COPILOT_RUNTIME_IDLE_TTL_MS?: string;
  COPILOT_RUNTIME_MAX_ACTIVE?: string;
  COPILOT_RUNTIME_HOME_ROOT?: string;
}

export function getCopilotRuntimeConfig(
  env: CopilotRuntimeEnv = process.env,
  storageRoot = getStorageRoot(),
): CopilotRuntimeConfig {
  return {
    idleTtlMs: parsePositiveInteger(
      env.COPILOT_RUNTIME_IDLE_TTL_MS,
      DEFAULT_IDLE_TTL_MS,
      'COPILOT_RUNTIME_IDLE_TTL_MS',
    ),
    maxActiveRuntimes: parsePositiveInteger(
      env.COPILOT_RUNTIME_MAX_ACTIVE,
      DEFAULT_MAX_ACTIVE_RUNTIMES,
      'COPILOT_RUNTIME_MAX_ACTIVE',
    ),
    homeRoot: env.COPILOT_RUNTIME_HOME_ROOT?.trim() || path.join(storageRoot, 'copilot-runtimes'),
  };
}

function parsePositiveInteger(rawValue: string | undefined, defaultValue: number, name: string): number {
  if (!rawValue?.trim()) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
