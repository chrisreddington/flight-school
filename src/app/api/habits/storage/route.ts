/**
 * Habits Storage API Route
 * GET/POST/DELETE /api/habits/storage
 *
 * Browser-facing persistence for user habits. Filename, default, and schema
 * guard are derived from {@link habitsRepo} so the route, the `/habits` RSC
 * accessor, and the Server Actions share one source of truth.
 */

import { createStorageRoute } from '@/lib/api';
import { habitsRepo } from '@/lib/habits/repo';
import { logger } from '@/lib/logger';

export const { GET, POST, DELETE } = createStorageRoute({
  filename: habitsRepo.filename,
  defaultSchema: habitsRepo.defaultValue,
  logger: logger.withTag('Habits Storage API'),
  validateSchema: habitsRepo.guard,
});
