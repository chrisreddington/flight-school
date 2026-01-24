/**
 * Tests for Active Operations Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { operationsManager } from './active-operations';
import type { OperationType } from './types';

// Helper to create a delayed executor
const createDelayedExecutor = <T>(result: T, delayMs: number) => {
  return (signal: AbortSignal): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
        } else {
          resolve(result);
        }
      }, delayMs);

      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  };
};

// Helper to clean up operations between tests
const cleanupOperations = () => {
  // Access private operations map through type assertion for testing
  const manager = operationsManager as unknown as { operations: Map<string, unknown> };
  manager.operations.clear();
};

describe('ActiveOperationsManager', () => {
  beforeEach(() => {
    cleanupOperations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('should register an operation and return its ID', () => {
      const operationId = operationsManager.start({
        id: 'test-op-1',
        type: 'topic-regeneration',
        targetId: 'topic-123',
        executor: createDelayedExecutor({ success: true }, 1000),
      });

      expect(operationId).toBe('test-op-1');
      expect(operationsManager.isActive('test-op-1')).toBe(true);
    });

    it('should track operation in snapshot by type', () => {
      operationsManager.start({
        id: 'test-op-2',
        type: 'topic-regeneration',
        targetId: 'topic-456',
        executor: createDelayedExecutor({ success: true }, 1000),
      });

      const snapshot = operationsManager.getSnapshot();
      expect(snapshot.topicRegenerations.has('test-op-2')).toBe(true);
      expect(snapshot.challengeRegenerations.size).toBe(0);
    });

    it('should abort previous operation if same ID is started', () => {
      const abortSpy = vi.fn();

      operationsManager.start({
        id: 'duplicate-op',
        type: 'topic-regeneration',
        executor: (signal) => {
          signal.addEventListener('abort', abortSpy);
          return createDelayedExecutor({ v: 1 }, 5000)(signal);
        },
      });

      // Start again with same ID
      operationsManager.start({
        id: 'duplicate-op',
        type: 'topic-regeneration',
        executor: createDelayedExecutor({ v: 2 }, 1000),
      });

      expect(abortSpy).toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('should abort an in-progress operation', async () => {
      const onError = vi.fn();

      operationsManager.start({
        id: 'abort-test',
        type: 'challenge-regeneration',
        executor: createDelayedExecutor({ success: true }, 5000),
        onError,
      });

      expect(operationsManager.isActive('abort-test')).toBe(true);

      const aborted = operationsManager.abort('abort-test');
      expect(aborted).toBe(true);

      // Let the abort propagate
      await vi.advanceTimersByTimeAsync(100);

      expect(operationsManager.isActive('abort-test')).toBe(false);
    });

    it('should return false for non-existent operation', () => {
      const result = operationsManager.abort('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('completion', () => {
    it('should call onComplete when operation succeeds', async () => {
      const onComplete = vi.fn();
      const result = { learningTopic: { id: 'new-topic' } };

      operationsManager.start({
        id: 'complete-test',
        type: 'topic-regeneration',
        executor: createDelayedExecutor(result, 100),
        onComplete,
      });

      // Fast forward past the delay
      await vi.advanceTimersByTimeAsync(150);

      expect(onComplete).toHaveBeenCalledWith(result);
    });

    it('should update status to complete', async () => {
      operationsManager.start({
        id: 'status-test',
        type: 'goal-regeneration',
        executor: createDelayedExecutor({ goal: 'done' }, 100),
      });

      await vi.advanceTimersByTimeAsync(150);

      const operation = operationsManager.get('status-test');
      expect(operation?.status).toBe('complete');
    });
  });

  describe('failure', () => {
    it('should call onError when operation fails', async () => {
      const onError = vi.fn();
      const error = new Error('API failed');

      operationsManager.start({
        id: 'fail-test',
        type: 'topic-regeneration',
        executor: () => Promise.reject(error),
        onError,
      });

      await vi.advanceTimersByTimeAsync(50);

      expect(onError).toHaveBeenCalledWith(error);
    });

    it('should update status to failed with error message', async () => {
      operationsManager.start({
        id: 'fail-status-test',
        type: 'topic-regeneration',
        executor: () => Promise.reject(new Error('Network error')),
      });

      await vi.advanceTimersByTimeAsync(50);

      const operation = operationsManager.get('fail-status-test');
      expect(operation?.status).toBe('failed');
      expect(operation?.error).toBe('Network error');
    });
  });

  describe('getActiveIdsOfType', () => {
    it('should return target IDs of active operations', () => {
      operationsManager.start({
        id: 'op-1',
        type: 'topic-regeneration',
        targetId: 'topic-A',
        executor: createDelayedExecutor({}, 5000),
      });

      operationsManager.start({
        id: 'op-2',
        type: 'topic-regeneration',
        targetId: 'topic-B',
        executor: createDelayedExecutor({}, 5000),
      });

      operationsManager.start({
        id: 'op-3',
        type: 'challenge-regeneration',
        targetId: 'challenge-X',
        executor: createDelayedExecutor({}, 5000),
      });

      const topicIds = operationsManager.getActiveIdsOfType('topic-regeneration');
      expect(topicIds.has('topic-A')).toBe(true);
      expect(topicIds.has('topic-B')).toBe(true);
      expect(topicIds.has('challenge-X')).toBe(false);
      expect(topicIds.size).toBe(2);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners when operation starts', () => {
      const listener = vi.fn();
      const unsubscribe = operationsManager.subscribe(listener);

      operationsManager.start({
        id: 'subscribe-test',
        type: 'topic-regeneration',
        executor: createDelayedExecutor({}, 1000),
      });

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('should notify listeners when operation completes', async () => {
      const listener = vi.fn();
      const unsubscribe = operationsManager.subscribe(listener);

      operationsManager.start({
        id: 'complete-notify-test',
        type: 'topic-regeneration',
        executor: createDelayedExecutor({}, 100),
      });

      listener.mockClear();
      await vi.advanceTimersByTimeAsync(150);

      expect(listener).toHaveBeenCalled();
      unsubscribe();
    });

    it('should not notify after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = operationsManager.subscribe(listener);
      unsubscribe();

      operationsManager.start({
        id: 'unsubscribe-test',
        type: 'topic-regeneration',
        executor: createDelayedExecutor({}, 1000),
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('hasActiveOfType', () => {
    it('should return true when operations of type are active', () => {
      operationsManager.start({
        id: 'active-type-test',
        type: 'goal-regeneration',
        executor: createDelayedExecutor({}, 5000),
      });

      expect(operationsManager.hasActiveOfType('goal-regeneration')).toBe(true);
      expect(operationsManager.hasActiveOfType('topic-regeneration')).toBe(false);
    });
  });
});
