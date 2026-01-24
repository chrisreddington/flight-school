/**
 * Shared State Machine Core
 *
 * Generic state transition primitives used by focus items and habits.
 * Provides type-safe state management with audit trails.
 *
 * @example
 * ```typescript
 * import { validateTransition, getCurrentState } from '@/lib/state-machine';
 *
 * const VALID_TRANSITIONS = {
 *   pending: ['active', 'skipped'],
 *   active: ['completed', 'failed'],
 *   completed: [],
 *   failed: ['pending'],
 *   skipped: [],
 * };
 *
 * validateTransition('pending', 'active', VALID_TRANSITIONS, 'task');
 * ```
 *
 * @see {@link validateTransition} for transition validation
 * @see {@link getCurrentState} for reading current state from history
 */

export * from './core';
