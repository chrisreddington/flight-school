/**
 * Focus Regeneration Store
 *
 * Singleton store that tracks which focus items are currently being regenerated.
 * Lives outside React lifecycle to persist across navigation.
 *
 * @remarks
 * This enables FocusHistory and other components to show loading states
 * for items being regenerated, even when the user navigates away from the
 * Dashboard where the regeneration was initiated.
 *
 * @example
 * ```typescript
 * import { regenerationStore } from '@/lib/focus';
 *
 * // Start regenerating a topic
 * regenerationStore.startRegenerating('topic', 'topic-123');
 *
 * // Check if a topic is being regenerated
 * if (regenerationStore.isRegenerating('topic', 'topic-123')) {
 *   // Show skeleton
 * }
 *
 * // Subscribe to changes
 * const unsubscribe = regenerationStore.subscribe(() => {
 *   // Re-render
 * });
 * ```
 */

import { logger } from '@/lib/logger';

const log = logger.withTag('RegenerationStore');

type ItemType = 'topic' | 'challenge' | 'goal';

// Suppress unused variable warning - logger kept for future debugging
void log;

type Listener = () => void;

interface RegenerationStoreInterface {
  /** Start tracking regeneration of an item */
  startRegenerating(type: ItemType, id: string): void;
  /** Stop tracking regeneration of an item */
  stopRegenerating(type: ItemType, id: string): void;
  /** Check if a specific item is being regenerated */
  isRegenerating(type: ItemType, id: string): boolean;
  /** Get all regenerating IDs for a type (returns stable reference for useSyncExternalStore) */
  getRegeneratingIds(type: ItemType): Set<string>;
  /** Subscribe to changes */
  subscribe(listener: Listener): () => void;
}

class RegenerationStore implements RegenerationStoreInterface {
  // Internal mutable sets
  private regeneratingTopics = new Set<string>();
  private regeneratingChallenges = new Set<string>();
  private regeneratingGoals = new Set<string>();
  private listeners = new Set<Listener>();
  
  // Cached immutable snapshots for useSyncExternalStore
  // These are only recreated when the underlying set changes
  private topicsSnapshot = new Set<string>();
  private challengesSnapshot = new Set<string>();
  private goalsSnapshot = new Set<string>();

  private getSetForType(type: ItemType): Set<string> {
    switch (type) {
      case 'topic':
        return this.regeneratingTopics;
      case 'challenge':
        return this.regeneratingChallenges;
      case 'goal':
        return this.regeneratingGoals;
    }
  }

  private updateSnapshot(type: ItemType): void {
    // Create new snapshot when data changes
    switch (type) {
      case 'topic':
        this.topicsSnapshot = new Set(this.regeneratingTopics);
        break;
      case 'challenge':
        this.challengesSnapshot = new Set(this.regeneratingChallenges);
        break;
      case 'goal':
        this.goalsSnapshot = new Set(this.regeneratingGoals);
        break;
    }
  }

  startRegenerating(type: ItemType, id: string): void {
    const set = this.getSetForType(type);
    if (!set.has(id)) {
      set.add(id);
      this.updateSnapshot(type);
      this.notifyListeners();
    }
  }

  stopRegenerating(type: ItemType, id: string): void {
    const set = this.getSetForType(type);
    if (set.has(id)) {
      set.delete(id);
      this.updateSnapshot(type);
      this.notifyListeners();
    }
  }

  isRegenerating(type: ItemType, id: string): boolean {
    return this.getSetForType(type).has(id);
  }

  getRegeneratingIds(type: ItemType): Set<string> {
    // Return cached snapshot - stable reference for useSyncExternalStore
    switch (type) {
      case 'topic':
        return this.topicsSnapshot;
      case 'challenge':
        return this.challengesSnapshot;
      case 'goal':
        return this.goalsSnapshot;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    });
  }
}

export const regenerationStore = new RegenerationStore();
