/**
 * Threads Storage API Route
 * GET/POST/DELETE /api/threads/storage
 *
 * Server-side persistence for chat threads.
 *
 * The GET handler hydrates in-flight streaming messages from per-job
 * scratchpads via the factory's `transformRead` hook — this is how
 * the polling client still sees live deltas even though the executor
 * no longer rewrites `threads.json` on every tick (Phase D scratchpad
 * refactor). See `src/lib/storage/scratchpad.ts` for the design.
 */

import { createStorageRoute } from '@/lib/api';
import type { Thread } from '@/lib/threads/types';
import { logger } from '@/lib/logger';
import { hydrateThreadsWithScratchpads } from '@/lib/storage/scratchpad';

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
  transformRead: async (userId, data) => ({
    ...data,
    threads: await hydrateThreadsWithScratchpads(userId, data.threads),
  }),
});

