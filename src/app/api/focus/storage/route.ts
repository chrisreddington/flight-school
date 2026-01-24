/**
 * Focus Storage API Route
 * GET/POST/DELETE /api/focus/storage
 *
 * Manages persistent storage of daily focus data in a JSON file.
 */

import { createStorageRoute } from '@/lib/api';
import type { FocusStorageSchema } from '@/lib/focus/types';
import { logger } from '@/lib/logger';

const DEFAULT_SCHEMA: FocusStorageSchema = { history: {} };

/**
 * Validates focus storage schema structure.
 */
function validateSchema(data: unknown): data is FocusStorageSchema {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  return typeof schema.history === 'object' && schema.history !== null;
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'focus-storage.json',
  defaultSchema: DEFAULT_SCHEMA,
  logger: logger.withTag('Focus Storage API'),
  validateSchema,
});

