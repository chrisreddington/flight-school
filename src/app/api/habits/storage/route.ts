/**
 * Habits Storage API Route
 * GET/POST/DELETE /api/habits/storage
 *
 * Server-side persistence for user habits.
 */

import { createStorageRoute } from '@/lib/api';
import type { HabitCollection } from '@/lib/habits/types';
import { logger } from '@/lib/logger';

const DEFAULT_SCHEMA: HabitCollection = { habits: [] };

/**
 * Validates habits storage schema structure.
 */
function validateSchema(data: unknown): data is HabitCollection {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return Array.isArray(schema.habits);
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'habits.json',
  defaultSchema: DEFAULT_SCHEMA,
  logger: logger.withTag('Habits Storage API'),
  validateSchema,
});

