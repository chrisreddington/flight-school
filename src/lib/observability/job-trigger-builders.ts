import type { ClientTriggerMetadata } from './trigger-metadata';

type SkippableTargetType = 'topic' | 'challenge' | 'goal';

const SKIP_ACTION_BY_TARGET_TYPE: Record<SkippableTargetType, ClientTriggerMetadata['action']> = {
  topic: 'skip-topic',
  challenge: 'skip-challenge',
  goal: 'skip-goal',
};

export type PartialClientTriggerMetadata = Omit<ClientTriggerMetadata, 'correlationId' | 'targetId'> & {
  correlationId?: string;
  targetId?: string;
};

function getCurrentPagePath(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const path = window.location?.pathname;
  if (typeof path !== 'string' || !path.startsWith('/')) return undefined;
  return path;
}

function getNavigationElapsedMs(): number | undefined {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return undefined;
  const elapsed = performance.now();
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  return Math.round(elapsed);
}

export function completeClientTriggerMetadata(
  trigger: PartialClientTriggerMetadata | undefined,
  fallbackTargetId: string,
): ClientTriggerMetadata | undefined {
  if (!trigger) return undefined;
  return {
    ...trigger,
    targetId: trigger.targetId ?? fallbackTargetId,
    correlationId: trigger.correlationId ?? crypto.randomUUID(),
  };
}

export function createLearningChatSendTrigger(threadId: string, correlationId: string): ClientTriggerMetadata {
  return {
    source: 'learning-chat',
    action: 'send-message',
    pagePath: getCurrentPagePath(),
    navigationElapsedMs: getNavigationElapsedMs(),
    targetType: 'thread',
    targetId: threadId,
    correlationId,
  };
}

export function createAiFocusSkipTrigger(
  targetType: SkippableTargetType,
  targetId: string,
): PartialClientTriggerMetadata {
  return {
    source: 'ai-focus',
    action: SKIP_ACTION_BY_TARGET_TYPE[targetType],
    pagePath: getCurrentPagePath(),
    navigationElapsedMs: getNavigationElapsedMs(),
    targetType,
    targetId,
  };
}
