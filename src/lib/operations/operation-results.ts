import type { ActiveOperation, OperationsSnapshot } from './types';

export interface OperationState {
  snapshot: OperationsSnapshot;
  activeIds: {
    topics: Set<string>;
    challenges: Set<string>;
    goals: Set<string>;
    chat: Set<string>;
  };
}

export function buildOperationState(
  operations: Iterable<[string, ActiveOperation]>,
  hydrated = false,
): OperationState {
  const topicRegenerations = new Map<string, ActiveOperation>();
  const challengeRegenerations = new Map<string, ActiveOperation>();
  const goalRegenerations = new Map<string, ActiveOperation>();
  const chatMessages = new Map<string, ActiveOperation>();
  const topics = new Set<string>();
  const challenges = new Set<string>();
  const goals = new Set<string>();
  const chat = new Set<string>();

  for (const [id, operation] of operations) {
    const isActive = operation.status === 'in-progress';
    const targetId = operation.meta.targetId ?? id;

    switch (operation.meta.type) {
      case 'topic-regeneration':
        topicRegenerations.set(id, operation);
        if (isActive) topics.add(targetId);
        break;
      case 'challenge-regeneration':
        challengeRegenerations.set(id, operation);
        if (isActive) challenges.add(targetId);
        break;
      case 'goal-regeneration':
        goalRegenerations.set(id, operation);
        if (isActive) goals.add(targetId);
        break;
      case 'chat-response':
        chatMessages.set(id, operation);
        if (isActive) chat.add(id);
        break;
    }
  }

  return {
    snapshot: {
      topicRegenerations,
      challengeRegenerations,
      goalRegenerations,
      chatMessages,
      hydrated,
    },
    activeIds: {
      topics,
      challenges,
      goals,
      chat,
    },
  };
}
