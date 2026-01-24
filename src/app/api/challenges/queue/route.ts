/**
 * Challenge Queue Storage API Route
 * GET/POST/DELETE /api/challenges/queue
 *
 * Server-side persistence for custom challenge queue.
 */

import { createStorageRoute } from '@/lib/api';
import type { DailyChallenge } from '@/lib/focus/types';
import { logger } from '@/lib/logger';

/**
 * Custom challenge queue schema.
 */
interface CustomChallengeQueue {
  challenges: DailyChallenge[];
  lastUpdated: string;
}

const DEFAULT_QUEUE: CustomChallengeQueue = {
  challenges: [],
  lastUpdated: '',
};

/**
 * Validates queue schema structure.
 */
function validateSchema(data: unknown): data is CustomChallengeQueue {
  if (typeof data !== 'object' || data === null) return false;
  const schema = data as Record<string, unknown>;
  
  if (!Array.isArray(schema.challenges)) return false;
  if (typeof schema.lastUpdated !== 'string') return false;
  
  // Validate each challenge has required fields
  for (const challenge of schema.challenges) {
    if (typeof challenge !== 'object' || challenge === null) return false;
    const c = challenge as Record<string, unknown>;
    if (typeof c.id !== 'string') return false;
    if (typeof c.title !== 'string') return false;
    if (typeof c.description !== 'string') return false;
    if (typeof c.language !== 'string') return false;
    if (!['beginner', 'intermediate', 'advanced'].includes(c.difficulty as string)) return false;
  }
  
  return true;
}

export const { GET, POST, DELETE } = createStorageRoute({
  filename: 'challenge-queue.json',
  defaultSchema: DEFAULT_QUEUE,
  logger: logger.withTag('Challenge Queue API'),
  validateSchema,
});
