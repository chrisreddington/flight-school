import type { SessionCreationMetrics } from './types';

interface NewSessionMetricsInput {
  poolKey: string;
  sessionCreateMs: number;
  mcpEnabled: boolean;
  model: string;
}

export function createNewSessionMetrics({
  poolKey,
  sessionCreateMs,
  mcpEnabled,
  model,
}: NewSessionMetricsInput): SessionCreationMetrics {
  return {
    poolKey,
    createdNew: true,
    sessionCreateMs,
    mcpEnabled,
    model,
    reusedConversation: false,
  };
}

export function createReusedSessionMetrics(metrics: SessionCreationMetrics): SessionCreationMetrics {
  return {
    ...metrics,
    createdNew: false,
    sessionCreateMs: 0,
    reusedConversation: true,
  };
}
