/**
 * Profile Storage API Route
 * GET/POST/DELETE /api/profile/storage
 *
 * Server-side persistence for cached user profile data. Filename, default, and
 * schema guard are derived from {@link profileRepo} so the route and the
 * document store share one source of truth.
 */

import { createStorageRoute } from '@/lib/api';
import { profileRepo } from '@/lib/profile/repo';
import { logger } from '@/lib/logger';

export const { GET, POST, DELETE } = createStorageRoute({
  filename: profileRepo.filename,
  defaultSchema: profileRepo.defaultValue,
  logger: logger.withTag('Profile Storage API'),
  validateSchema: profileRepo.guard,
});
