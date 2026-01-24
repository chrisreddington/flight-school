/**
 * Threads Storage API Route
 * GET/POST/DELETE /api/threads/storage
 *
 * Server-side persistence for chat threads.
 */

import { createStorageRoute } from '@/lib/api';
import type { Thread } from '@/lib/threads/types';
import { logger } from '@/lib/logger';

/** Schema for threads storage */
export interface ThreadsStorageSchema {
  /** All chat threads */
  threads: Thread[];
}

const DEFAULT_SCHEMA: ThreadsStorageSchema = { threads: [] };

/**
 * Validates threads storage schema structure.
 */
function validateSchema(data: unknown): data is ThreadsStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return Array.isArray(schema.threads);
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'threads.json',
  defaultSchema: DEFAULT_SCHEMA,
  logger: logger.withTag('Threads Storage API'),
  validateSchema,
});

