/**
 * Per-user custom-challenge-queue repository — the single source of truth for
 * the queue singleton's filename, default, and schema guard.
 *
 * `challenge-queue.json` is written from two server callers (the
 * `/api/challenges/queue` storage route and the `/challenge/edit` Server
 * Actions in `@/app/challenge/actions`) plus read through the route by the
 * browser client in `@/lib/challenge/custom-queue`. Each previously carried its
 * own copy of the schema, default, and guard — and the two copies disagreed
 * (the route validated every challenge's fields; the action only checked the
 * envelope shape). {@link challengeQueueRepo} unifies them on the stricter
 * per-challenge guard, which is the server write-validation boundary.
 *
 * The schema carries no server-stamped field — callers set `lastUpdated`
 * themselves — so this repo configures no `stamp`.
 *
 * @module challenge/queue-repo
 */

import { createSingletonRepo } from '@/lib/storage/document-store/singleton-repo';
import type { DailyChallenge } from '@/lib/focus/types';

/** Ordered FIFO queue of user-authored custom challenges. */
export interface CustomChallengeQueue {
  /** Custom challenges; the first item is the next one surfaced. */
  challenges: DailyChallenge[];
  /** ISO timestamp of the last mutation. */
  lastUpdated: string;
}

const DEFAULT_QUEUE: CustomChallengeQueue = {
  challenges: [],
  lastUpdated: '',
};

/**
 * Validate the persisted queue. Beyond the envelope shape, every challenge must
 * carry the string fields the challenge UI depends on and a recognised
 * difficulty — a malformed entry fails the whole document, which the store then
 * heals to {@link DEFAULT_QUEUE}.
 */
export function isCustomChallengeQueue(value: unknown): value is CustomChallengeQueue {
  if (typeof value !== 'object' || value === null) return false;
  const schema = value as Record<string, unknown>;

  if (!Array.isArray(schema.challenges)) return false;
  if (typeof schema.lastUpdated !== 'string') return false;

  for (const challenge of schema.challenges) {
    if (typeof challenge !== 'object' || challenge === null) return false;
    const candidate = challenge as Record<string, unknown>;
    if (typeof candidate.id !== 'string') return false;
    if (typeof candidate.title !== 'string') return false;
    if (typeof candidate.description !== 'string') return false;
    if (typeof candidate.language !== 'string') return false;
    if (!['beginner', 'intermediate', 'advanced'].includes(candidate.difficulty as string)) return false;
  }

  return true;
}

/**
 * Server-side custom-challenge-queue accessor. The storage route and the
 * challenge-edit Server Actions consume this repo's
 * {@link SingletonRepo.filename}, {@link SingletonRepo.defaultValue}, and
 * {@link SingletonRepo.guard}.
 */
export const challengeQueueRepo = createSingletonRepo<CustomChallengeQueue>({
  filename: 'challenge-queue.json',
  defaultValue: DEFAULT_QUEUE,
  guard: isCustomChallengeQueue,
});
