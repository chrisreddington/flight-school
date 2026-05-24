/**
 * Server-side accessor for the user's habits collection. Used by the
 * `/habits` RSC for initial render — Server Components and Server Actions
 * read/write here, bypassing the client HTTP round-trip.
 */

import { readUserStorage } from '@/lib/storage/user-storage';
import type { HabitCollection } from './types';

const HABITS_FILENAME = 'habits.json';

const DEFAULT_COLLECTION: HabitCollection = { habits: [] };

function isHabitCollection(data: unknown): data is HabitCollection {
  if (typeof data !== 'object' || data === null) return false;
  return Array.isArray((data as Record<string, unknown>).habits);
}

/**
 * Returns every habit owned by the authenticated user. The caller is
 * responsible for partitioning into active/completed/abandoned buckets.
 */
export async function readUserHabits(): Promise<HabitCollection> {
  return readUserStorage<HabitCollection>(HABITS_FILENAME, DEFAULT_COLLECTION, isHabitCollection);
}
