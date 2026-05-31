/**
 * Per-user habits-collection repository — the single source of truth for the
 * habits singleton's filename, default, and schema guard.
 *
 * Before S1, three places re-declared the same `isHabitCollection` guard and
 * `habits.json` / `{ habits: [] }` pair: the RSC accessor in `./server`, the
 * storage route at `app/api/habits/storage/route.ts`, and the Server Actions in
 * `app/habits/actions.ts`. {@link habitsRepo} collapses the server-side copies
 * into one typed accessor so they cannot drift.
 *
 * Unlike `skillsRepo`, the collection carries no server-stamped timestamp, so
 * this repo configures no `stamp`.
 *
 * @module habits/repo
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import type { HabitCollection } from './types';

const DEFAULT_HABIT_COLLECTION: HabitCollection = { habits: [] };

/**
 * Validate the persisted habits-collection shape. A document failing this guard
 * is treated as absent (read heals to the default; write is rejected).
 */
export function isHabitCollection(value: unknown): value is HabitCollection {
  if (typeof value !== 'object' || value === null) return false;
  return Array.isArray((value as Record<string, unknown>).habits);
}

/**
 * Server-side habits-collection accessor. Both the `/habits` RSC accessor and
 * the storage route consume this repo's {@link SingletonRepo.filename},
 * {@link SingletonRepo.defaultValue}, and {@link SingletonRepo.guard}.
 */
export const habitsRepo = createSingletonRepo<HabitCollection>({
  filename: 'habits.json',
  defaultValue: DEFAULT_HABIT_COLLECTION,
  guard: isHabitCollection,
});
