/**
 * Tests for state machine core utilities.
 *
 * Covers state transitions and history management.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTransition,
  getCurrentState,
  type StateTransition,
} from './core';

// Test state types
type TestState = 'pending' | 'active' | 'completed' | 'cancelled';

const TEST_TRANSITIONS: Record<TestState, TestState[]> = {
  pending: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [], // Terminal state
  cancelled: [], // Terminal state
};

describe('validateTransition', () => {
  describe('valid transitions', () => {
    it.each([
      { from: 'pending', to: 'active' },
      { from: 'pending', to: 'cancelled' },
      { from: 'active', to: 'completed' },
      { from: 'active', to: 'cancelled' },
    ] as const)('should allow $from → $to', ({ from, to }) => {
      expect(() =>
        validateTransition(from, to, TEST_TRANSITIONS, 'test')
      ).not.toThrow();
    });
  });

  describe('invalid transitions', () => {
    it.each([
      { from: 'pending', to: 'completed', desc: 'skipping active' },
      { from: 'active', to: 'pending', desc: 'going backwards' },
      { from: 'completed', to: 'active', desc: 'from terminal state' },
      { from: 'completed', to: 'pending', desc: 'from terminal to start' },
      { from: 'cancelled', to: 'active', desc: 'from cancelled' },
    ] as const)('should reject $from → $to ($desc)', ({ from, to }) => {
      expect(() =>
        validateTransition(from, to, TEST_TRANSITIONS, 'test')
      ).toThrow(/Invalid test state transition/);
    });

    it('should include helpful error message', () => {
      expect(() =>
        validateTransition('pending', 'completed', TEST_TRANSITIONS, 'habit')
      ).toThrow(
        'Invalid habit state transition: pending → completed. Valid transitions: active, cancelled'
      );
    });

    it('should show empty transitions for terminal states', () => {
      expect(() =>
        validateTransition('completed', 'active', TEST_TRANSITIONS, 'focus')
      ).toThrow(
        'Invalid focus state transition: completed → active. Valid transitions: none (terminal state)'
      );
    });
  });

  describe('idempotent transitions', () => {
    it.each(['pending', 'active', 'completed', 'cancelled'] as const)(
      'should allow %s → %s (same state)',
      (state) => {
        expect(() =>
          validateTransition(state, state, TEST_TRANSITIONS, 'test')
        ).not.toThrow();
      }
    );
  });
});

describe('getCurrentState', () => {
  describe('with valid history', () => {
    it('should return the most recent state', () => {
      const history: StateTransition<TestState>[] = [
        { state: 'pending', timestamp: '2026-01-01T00:00:00Z' },
        { state: 'active', timestamp: '2026-01-01T01:00:00Z' },
        { state: 'completed', timestamp: '2026-01-01T02:00:00Z' },
      ];

      expect(getCurrentState(history)).toBe('completed');
    });

    it('should work with single entry', () => {
      const history: StateTransition<TestState>[] = [
        { state: 'pending', timestamp: '2026-01-01T00:00:00Z' },
      ];

      expect(getCurrentState(history)).toBe('pending');
    });

    it('should preserve metadata in history entries', () => {
      const history: StateTransition<TestState>[] = [
        {
          state: 'pending',
          timestamp: '2026-01-01T00:00:00Z',
          source: 'dashboard',
          note: 'Initial creation',
        },
        {
          state: 'active',
          timestamp: '2026-01-01T01:00:00Z',
          source: 'sandbox',
        },
      ];

      expect(getCurrentState(history)).toBe('active');
      expect(history[0].source).toBe('dashboard');
      expect(history[0].note).toBe('Initial creation');
    });
  });

  describe('with empty history', () => {
    it('should throw descriptive error', () => {
      const history: StateTransition<TestState>[] = [];

      expect(() => getCurrentState(history)).toThrow('State history is empty');
    });
  });
});
