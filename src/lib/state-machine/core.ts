/**
 * Shared State Machine Core
 * 
 * Generic state transition primitives used by focus items and habits.
 * Provides type-safe state management with audit trails.
 */

/**
 * Represents a single state transition with timestamp and optional metadata.
 */
export interface StateTransition<TState> {
  /** The state being transitioned to */
  state: TState;
  /** ISO timestamp when transition occurred */
  timestamp: string;
  /** Optional source of the transition (e.g., 'dashboard', 'sandbox', 'history') */
  source?: string;
  /** Optional note about the transition */
  note?: string;
}

/**
 * Wraps an item with its state history.
 */
export interface StatefulItem<TData, TState> {
  /** The item data */
  data: TData;
  /** History of state transitions (ordered chronologically) */
  stateHistory: StateTransition<TState>[];
}

/**
 * Validates if a state transition is allowed.
 *
 * @param currentState - Current state of the item
 * @param newState - Target state to transition to
 * @param validTransitions - Map of allowed state transitions
 * @param itemType - Item type name for error messages (e.g., "habit", "focus")
 * @throws {Error} If transition is invalid
 */
export function validateTransition<TState>(
  currentState: TState,
  newState: TState,
  validTransitions: Record<TState & string, TState[]>,
  itemType: string
): void {
  if (currentState === newState) {
    return; // Idempotent transitions are allowed
  }

  const allowedStates = validTransitions[currentState as string & TState];
  if (!allowedStates.includes(newState)) {
    throw new Error(
      `Invalid ${itemType} state transition: ${String(currentState)} → ${String(newState)}. ` +
      `Valid transitions: ${allowedStates.join(', ') || 'none (terminal state)'}`
    );
  }
}

/**
 * Gets the current state from state history.
 *
 * @param stateHistory - Chronological list of state transitions
 * @returns The most recent state
 * @throws {Error} If state history is empty
 */
export function getCurrentState<TState>(stateHistory: StateTransition<TState>[]): TState {
  if (stateHistory.length === 0) {
    throw new Error('State history is empty');
  }
  return stateHistory[stateHistory.length - 1].state;
}
