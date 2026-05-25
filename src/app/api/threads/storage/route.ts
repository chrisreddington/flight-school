/**
 * Threads Storage API Route
 * GET/POST/DELETE /api/threads/storage
 *
 * Server-side persistence for chat threads. Live streaming content is
 * delivered via SSE on `/api/jobs/{jobId}/stream`; this route serves
 * only the durable thread state, rewritten exactly once per assistant
 * message by the worker.
 */

import { createStorageRoute } from '@/lib/api';
import type { Thread } from '@/lib/threads/types';
import { stripLegacyCursorFromThread } from '@/lib/threads/legacy-cursor';
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
  // Strip stale streaming cursor glyphs from any thread written by a
  // worker that predates cursor cleanup, so cold reloads never surface
  // the stale stream artefact.
  transformRead: (_userId, data) => ({
    ...data,
    threads: data.threads.map((t) => stripLegacyCursorFromThread(t)),
  }),
});
