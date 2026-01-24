/**
 * Habit Storage
 * 
 * Server-side API persistence for user habits.
 */

import { apiGet, apiPost } from '@/lib/api-client';
import { logger } from '@/lib/logger';
import type { HabitCollection, HabitWithHistory, Habit } from './types';
import { MAX_ACTIVE_HABITS, createHabitWithHistory } from './types';

const log = logger.withTag('Habit Storage');

// =============================================================================
// Storage Operations
// =============================================================================

/**
 * Loads all habits from server storage.
 */
async function loadHabits(): Promise<HabitCollection> {
  try {
    const data = await apiGet<HabitCollection>('/api/habits/storage');
    return data;
  } catch (error) {
    log.error('Failed to load habits', { error });
    return { habits: [] };
  }
}

/**
 * Saves habits collection to server storage.
 */
async function saveHabits(collection: HabitCollection): Promise<void> {
  try {
    await apiPost<void>('/api/habits/storage', collection);
    log.info(`Saved ${collection.habits.length} habits`);
  } catch (error) {
    log.error('Failed to save habits', { error });
    throw error;
  }
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Creates a new habit.
 * 
 * @throws {Error} If max active habits exceeded
 */
async function createNewHabit(habit: Habit): Promise<HabitWithHistory> {
  const collection = await loadHabits();
  
  // Check active habit limit
  const activeCount = collection.habits.filter(
    h => h.state === 'not-started' || h.state === 'active' || h.state === 'paused'
  ).length;

  if (activeCount >= MAX_ACTIVE_HABITS) {
    throw new Error(`Maximum ${MAX_ACTIVE_HABITS} active habits allowed`);
  }

  const habitWithHistory = createHabitWithHistory(habit);
  collection.habits.push(habitWithHistory);
  await saveHabits(collection);

  return habitWithHistory;
}

/**
 * Updates an existing habit.
 */
async function updateHabit(updatedHabit: HabitWithHistory): Promise<void> {
  const collection = await loadHabits();
  const index = collection.habits.findIndex(h => h.id === updatedHabit.id);

  if (index === -1) {
    throw new Error(`Habit ${updatedHabit.id} not found`);
  }

  collection.habits[index] = updatedHabit;
  await saveHabits(collection);
}

/**
 * Gets a single habit by ID.
 */
async function getHabit(habitId: string): Promise<HabitWithHistory | null> {
  const collection = await loadHabits();
  return collection.habits.find(h => h.id === habitId) || null;
}

/**
 * Gets all active habits.
 */
async function getActiveHabits(): Promise<HabitWithHistory[]> {
  const collection = await loadHabits();
  return collection.habits.filter(
    h => h.state === 'not-started' || h.state === 'active' || h.state === 'paused'
  );
}

/**
 * Gets all completed habits.
 */
async function getCompletedHabits(): Promise<HabitWithHistory[]> {
  const collection = await loadHabits();
  return collection.habits.filter(h => h.state === 'completed');
}

/**
 * Deletes a habit.
 */
async function deleteHabit(habitId: string): Promise<void> {
  const collection = await loadHabits();
  collection.habits = collection.habits.filter(h => h.id !== habitId);
  await saveHabits(collection);
}

// =============================================================================
// Convenience Store Interface
// =============================================================================

/**
 * Habit store with convenient methods.
 */
export const habitStore = {
  load: loadHabits,
  save: saveHabits,
  create: createNewHabit,
  update: updateHabit,
  get: getHabit,
  getActive: getActiveHabits,
  getCompleted: getCompletedHabits,
  delete: deleteHabit,
};
