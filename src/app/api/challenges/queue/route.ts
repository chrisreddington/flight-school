/**
 * Challenge Queue Storage API Route
 * GET/POST/DELETE /api/challenges/queue
 *
 * Server-side persistence for the custom challenge queue. Filename, default,
 * and schema guard are derived from {@link challengeQueueRepo} so the route,
 * the challenge-edit Server Actions, and the document store share one source
 * of truth.
 */

import { createStorageRoute } from '@/lib/api';
import { challengeQueueRepo } from '@/lib/challenge/queue-repo';
import { logger } from '@/lib/logger';

export const { GET, POST, DELETE } = createStorageRoute({
  filename: challengeQueueRepo.filename,
  defaultSchema: challengeQueueRepo.defaultValue,
  logger: logger.withTag('Challenge Queue API'),
  validateSchema: challengeQueueRepo.guard,
});
