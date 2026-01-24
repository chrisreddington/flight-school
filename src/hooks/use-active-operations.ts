/**
 * useActiveOperations Hook
 *
 * Subscribe to the global operations manager to get loading states
 * for AI operations across any component.
 *
 * @example
 * ```typescript
 * const { activeTopicIds, isOperationActive } = useActiveOperations();
 *
 * // Show skeleton for any topic being regenerated
 * if (activeTopicIds.has(topic.id)) {
 *   return <Skeleton />;
 * }
 * ```
 */

import { operationsManager } from '@/lib/operations';
import type { OperationType } from '@/lib/operations';
import { useSyncExternalStore, useMemo, useEffect } from 'react';

interface UseActiveOperationsResult {
  /** Set of topic IDs currently being regenerated */
  activeTopicIds: Set<string>;
  /** Set of challenge IDs currently being regenerated */
  activeChallengeIds: Set<string>;
  /** Set of goal IDs currently being regenerated */
  activeGoalIds: Set<string>;
  /** Set of chat message operation IDs in progress */
  activeChatIds: Set<string>;
  /** Check if any operation of a type is active */
  hasActiveOfType: (type: OperationType) => boolean;
  /** Check if a specific operation is active */
  isOperationActive: (operationId: string) => boolean;
}

// Stable empty set for SSR fallback
const emptySet = new Set<string>();

// Snapshot function - returns the cached snapshot from manager
const getSnapshot = () => operationsManager.getSnapshot();

// SSR fallback - return empty snapshot
const serverSnapshot = {
  topicRegenerations: new Map(),
  challengeRegenerations: new Map(),
  goalRegenerations: new Map(),
  chatMessages: new Map(),
};
const getServerSnapshot = () => serverSnapshot;

export function useActiveOperations(): UseActiveOperationsResult {
  // Initialize operations manager on first render (checks backend for active jobs)
  useEffect(() => {
    operationsManager.initialize();
  }, []);

  // Subscribe to the operations manager
  const snapshot = useSyncExternalStore(
    operationsManager.subscribe.bind(operationsManager),
    getSnapshot,
    getServerSnapshot
  );

  // Derive the active IDs from snapshot
  // Memoize to avoid creating new Sets on every render
  const activeTopicIds = useMemo(() => {
    const ids = new Set<string>();
    for (const op of snapshot.topicRegenerations.values()) {
      if (op.status === 'in-progress' && op.meta.targetId) {
        ids.add(op.meta.targetId);
      }
    }
    return ids.size > 0 ? ids : emptySet;
  }, [snapshot.topicRegenerations]);

  const activeChallengeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const op of snapshot.challengeRegenerations.values()) {
      if (op.status === 'in-progress' && op.meta.targetId) {
        ids.add(op.meta.targetId);
      }
    }
    return ids.size > 0 ? ids : emptySet;
  }, [snapshot.challengeRegenerations]);

  const activeGoalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const op of snapshot.goalRegenerations.values()) {
      if (op.status === 'in-progress' && op.meta.targetId) {
        ids.add(op.meta.targetId);
      }
    }
    return ids.size > 0 ? ids : emptySet;
  }, [snapshot.goalRegenerations]);

  const activeChatIds = useMemo(() => {
    const ids = new Set<string>();
    for (const op of snapshot.chatMessages.values()) {
      if (op.status === 'in-progress') {
        ids.add(op.id);
      }
    }
    return ids.size > 0 ? ids : emptySet;
  }, [snapshot.chatMessages]);

  // Utility functions
  const hasActiveOfType = (type: OperationType): boolean => {
    return operationsManager.hasActiveOfType(type);
  };

  const isOperationActive = (operationId: string): boolean => {
    return operationsManager.isActive(operationId);
  };

  return {
    activeTopicIds,
    activeChallengeIds,
    activeGoalIds,
    activeChatIds,
    hasActiveOfType,
    isOperationActive,
  };
}
