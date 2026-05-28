/**
 * Post-process learning topics returned by the LLM so the Learn pane
 * isn't dominated by the user's current repo.
 *
 * Contract per improvement plan M3.2:
 *   - Generator asks for FIVE candidates with a `dominantSignal`.
 *   - Pick top THREE such that at most ONE has signal `current-repo`.
 *   - Order is preserved otherwise (the LLM already ordered by relevance).
 *   - If fewer than three after filtering, return what we have rather
 *     than failing.
 *   - Topics with no `dominantSignal` (legacy / partial parses) are
 *     treated as non-`current-repo` so they are never starved.
 */

import type { LearningTopic } from '@/lib/focus/base-types';

const MAX_RETURNED = 3;
const MAX_CURRENT_REPO = 1;

/**
 * Diversify a candidate list so at most {@link MAX_CURRENT_REPO} topics
 * have `dominantSignal === 'current-repo'`. Returns up to
 * {@link MAX_RETURNED} topics, preserving the input order.
 */
export function diversifyLearningTopics(candidates: readonly LearningTopic[]): LearningTopic[] {
  const picked: LearningTopic[] = [];
  let currentRepoTaken = 0;

  for (const topic of candidates) {
    if (picked.length >= MAX_RETURNED) break;
    const isCurrentRepo = topic.dominantSignal === 'current-repo';
    if (isCurrentRepo && currentRepoTaken >= MAX_CURRENT_REPO) continue;
    picked.push(topic);
    if (isCurrentRepo) currentRepoTaken += 1;
  }

  // If diversification starved us below MAX_RETURNED (e.g. all 5 were
  // current-repo), backfill from the rejected current-repo entries so
  // the user still gets three topics. This is a deliberate trade — we
  // prefer "a little repetitive" over "fewer topics".
  if (picked.length < MAX_RETURNED) {
    for (const topic of candidates) {
      if (picked.length >= MAX_RETURNED) break;
      if (picked.includes(topic)) continue;
      picked.push(topic);
    }
  }

  return picked;
}
