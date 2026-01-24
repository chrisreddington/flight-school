/**
 * Profile Storage API Route
 * GET/POST/DELETE /api/profile/storage
 *
 * Server-side persistence for cached user profile data.
 */

import { createStorageRoute } from '@/lib/api';
import type { ProfileResponse } from '@/app/api/profile/route';
import { logger } from '@/lib/logger';

/** Schema for profile storage with date-based caching */
interface ProfileStorageSchema {
  /** ISO date string (YYYY-MM-DD) for cache invalidation */
  date: string;
  /** Cached profile data */
  profile: ProfileResponse;
}

const DEFAULT_SCHEMA: ProfileStorageSchema | null = null;

/**
 * Validates profile storage schema structure.
 */
function validateSchema(data: unknown): data is ProfileStorageSchema | null {
  if (data === null) return true;
  if (typeof data !== 'object') return false;
  const schema = data as Record<string, unknown>;
  return typeof schema.date === 'string' && 
         typeof schema.profile === 'object' && 
         schema.profile !== null;
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'profile-cache.json',
  defaultSchema: DEFAULT_SCHEMA,
  logger: logger.withTag('Profile Storage API'),
  validateSchema,
});

