/**
 * useRegenerationState Hook
 *
 * Subscribe to the global regeneration store to get loading states
 * for focus items being regenerated across any component.
 *
 * @example
 * ```typescript
 * const { isRegenerating, regeneratingTopicIds } = useRegenerationState();
 * 
 * if (regeneratingTopicIds.has(topic.id)) {
 *   return <Skeleton />;
 * }
 * ```
 */

import { regenerationStore } from '@/lib/focus';
import { useSyncExternalStore } from 'react';

type ItemType = 'topic' | 'challenge' | 'goal';

interface UseRegenerationStateResult {
  /** Check if a specific item is being regenerated */
  isRegenerating: (type: ItemType, id: string) => boolean;
  /** Set of topic IDs currently being regenerated */
  regeneratingTopicIds: Set<string>;
  /** Set of challenge IDs currently being regenerated */
  regeneratingChallengeIds: Set<string>;
  /** Set of goal IDs currently being regenerated */
  regeneratingGoalIds: Set<string>;
}

// Snapshot functions for useSyncExternalStore
const getTopicSnapshot = () => regenerationStore.getRegeneratingIds('topic');
const getChallengeSnapshot = () => regenerationStore.getRegeneratingIds('challenge');
const getGoalSnapshot = () => regenerationStore.getRegeneratingIds('goal');

// SSR fallbacks
const emptySet = new Set<string>();
const getServerSnapshot = () => emptySet;

export function useRegenerationState(): UseRegenerationStateResult {
  const regeneratingTopicIds = useSyncExternalStore(
    regenerationStore.subscribe.bind(regenerationStore),
    getTopicSnapshot,
    getServerSnapshot
  );

  const regeneratingChallengeIds = useSyncExternalStore(
    regenerationStore.subscribe.bind(regenerationStore),
    getChallengeSnapshot,
    getServerSnapshot
  );

  const regeneratingGoalIds = useSyncExternalStore(
    regenerationStore.subscribe.bind(regenerationStore),
    getGoalSnapshot,
    getServerSnapshot
  );

  const isRegenerating = (type: ItemType, id: string): boolean => {
    return regenerationStore.isRegenerating(type, id);
  };

  return {
    isRegenerating,
    regeneratingTopicIds,
    regeneratingChallengeIds,
    regeneratingGoalIds,
  };
}
