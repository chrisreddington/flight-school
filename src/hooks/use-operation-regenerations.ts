/**
 * useOperationRegenerations
 *
 * Subscribes to the global {@link operationsManager} for the three
 * regeneration types the focus page cares about (topics, challenges,
 * goals). Returns the live Sets of in-flight item IDs so a hook
 * consumer can render skip/cancel UI even after the user navigates
 * away and back.
 *
 * Extracted out of {@link useAIFocus} so the cross-component visibility
 * seam (operationsManager pub/sub) is testable in isolation from the
 * focus fetch lifecycle.
 */

import { useSyncExternalStore } from 'react';

import { operationsManager } from '@/lib/operations';

// useSyncExternalStore demands a stable getServerSnapshot reference; a
// fresh `new Set()` per call would loop indefinitely.
const EMPTY_STRING_SET = new Set<string>();
const getEmptySet = () => EMPTY_STRING_SET;

const subscribe = operationsManager.subscribe.bind(operationsManager);

export interface OperationRegenerations {
  skippingTopicIds: Set<string>;
  skippingChallengeIds: Set<string>;
  skippingGoalIds: Set<string>;
}

export function useOperationRegenerations(): OperationRegenerations {
  const skippingTopicIds = useSyncExternalStore(
    subscribe,
    () => operationsManager.getActiveIdsOfType('topic-regeneration'),
    getEmptySet,
  );

  const skippingChallengeIds = useSyncExternalStore(
    subscribe,
    () => operationsManager.getActiveIdsOfType('challenge-regeneration'),
    getEmptySet,
  );

  const skippingGoalIds = useSyncExternalStore(
    subscribe,
    () => operationsManager.getActiveIdsOfType('goal-regeneration'),
    getEmptySet,
  );

  return { skippingTopicIds, skippingChallengeIds, skippingGoalIds };
}
