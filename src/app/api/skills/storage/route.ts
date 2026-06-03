/**
 * Skills Storage API Route
 * GET/POST/DELETE /api/skills/storage
 *
 * Browser-facing persistence for user skill profiles. Filename, default, and
 * schema guard are derived from {@link skillsRepo} so the route and the
 * server-side accessors share one source of truth. The factory persists the
 * client's body verbatim (no `lastUpdated` re-stamp) because the client store
 * already stamps before POSTing; only the server accessors stamp.
 */

import { createStorageRoute } from '@/lib/api';
import { skillsRepo } from '@/lib/skills/repo';
import { logger } from '@/lib/logger';

export const { GET, POST, DELETE } = createStorageRoute({
  filename: skillsRepo.filename,
  defaultSchema: skillsRepo.defaultValue,
  logger: logger.withTag('Skills Storage API'),
  validateSchema: skillsRepo.guard,
});
