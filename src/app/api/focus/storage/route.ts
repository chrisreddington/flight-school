/**
 * Focus Storage API Route
 * GET/POST/DELETE /api/focus/storage
 *
 * Browser-facing persistence for the user's Daily Focus history. Filename,
 * default, and schema guard are derived from {@link focusRepo} so the route and
 * the document store share one source of truth.
 */

import { createStorageRoute } from '@/lib/api';
import { focusRepo } from '@/lib/focus/repo';
import { logger } from '@/lib/logger';

export const { GET, POST, DELETE } = createStorageRoute({
  filename: focusRepo.filename,
  defaultSchema: focusRepo.defaultValue,
  logger: logger.withTag('Focus Storage API'),
  validateSchema: focusRepo.guard,
});
