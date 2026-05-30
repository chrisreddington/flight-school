/**
 * Server-side accessor for the user's habits collection. Used by the
 * `/habits` RSC for initial render — Server Components and Server Actions
 * read here, bypassing the client HTTP round-trip. Reads/writes resolve the
 * authenticated user, then delegate to the shared {@link habitsRepo} (the
 * single source of the filename/default/guard).
 */

import { requireUserContext } from '@/lib/auth/context';
import { habitsRepo } from './repo';
import type { HabitCollection } from './types';

/**
 * Returns every habit owned by the authenticated user. The caller is
 * responsible for partitioning into active/completed/abandoned buckets.
 */
export async function readUserHabits(): Promise<HabitCollection> {
  const { userId } = await requireUserContext();
  return habitsRepo.read(userId);
}
