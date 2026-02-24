/**
 * Spaced Repetition for Learning Topics
 *
 * Implements the Ebbinghaus forgetting curve decay model to surface topics
 * that are due for review. The decay schedule is based on meta-analysis by
 * Cepeda et al. (2006): review just before forgetting resets the curve.
 *
 * @remarks
 * Review intervals used (SM-2 inspired, validated by spaced repetition research):
 * - 1 day   → first review due
 * - 3 days  → second review due
 * - 7 days  → third review due
 * - 21+ days → "forgotten" state, highest priority
 *
 * This module is client-side only (reads from FocusHistory via localStorage).
 * No backend required — localStorage is sufficient for the decay schedule.
 */

import type { FocusHistory } from './types';

/** The decay intervals in days (Ebbinghaus-based review schedule). */
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 21] as const;

/** Days beyond which a topic is considered in "forgotten" state. */
const FORGOTTEN_THRESHOLD_DAYS = 21;

/** A topic candidate surfaced by the spaced repetition algorithm. */
export interface SpacedRepCandidate {
  /** Topic ID from FocusHistory. */
  topicId: string;
  /** Topic title. */
  title: string;
  /** Days since the topic was last explored. */
  daysSinceSeen: number;
  /** Whether this topic is in the "forgotten" zone (21+ days). */
  isForgotten: boolean;
  /** Priority score — higher means more urgently due. */
  priority: number;
}

/**
 * Computes days between an ISO timestamp and now.
 *
 * @param isoTimestamp - ISO 8601 date string
 * @returns Number of full days elapsed
 */
function daysSince(isoTimestamp: string): number {
  const then = new Date(isoTimestamp).getTime();
  const now = Date.now();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

/**
 * Determines if a topic is due for review based on days since last seen.
 *
 * Topics are due when their `daysSinceSeen` crosses the next interval boundary.
 * E.g., a topic seen 1 day ago is due (first interval); 3 days ago is due again.
 *
 * @param daysSinceSeen - Days since the topic was last explored
 * @returns True if review is due
 */
function isReviewDue(daysSinceSeen: number): boolean {
  return REVIEW_INTERVALS_DAYS.some((interval) => daysSinceSeen >= interval);
}

/**
 * Computes a priority score for a topic.
 * Higher score = more urgently needs review.
 *
 * @param daysSinceSeen - Days since last seen
 * @returns Priority score (0–100)
 */
function computePriority(daysSinceSeen: number): number {
  if (daysSinceSeen >= FORGOTTEN_THRESHOLD_DAYS) return 100;
  if (daysSinceSeen >= 7) return 75;
  if (daysSinceSeen >= 3) return 50;
  if (daysSinceSeen >= 1) return 25;
  return 0;
}

/**
 * Extracts all explored topics from focus history and identifies those due for review.
 *
 * @param history - FocusHistory from localStorage
 * @returns Sorted array of topics due for review, highest priority first
 *
 * @example
 * ```typescript
 * const history = loadFocusHistory();
 * const due = getSpacedRepCandidates(history);
 * // due[0] is the most urgently overdue topic
 * ```
 */
export function getSpacedRepCandidates(history: FocusHistory): SpacedRepCandidate[] {
  const seen = new Map<string, { title: string; exploredAt: string }>();

  // Walk history and collect the most recent exploredAt for each topic
  for (const record of Object.values(history)) {
    for (const topicSet of record.learningTopics) {
      for (const statefulTopic of topicSet) {
        const topic = statefulTopic.data;
        if (topic.explored && topic.exploredAt) {
          const existing = seen.get(topic.id);
          if (!existing || topic.exploredAt > existing.exploredAt) {
            seen.set(topic.id, { title: topic.title, exploredAt: topic.exploredAt });
          }
        }
      }
    }
  }

  const candidates: SpacedRepCandidate[] = [];

  for (const [topicId, { title, exploredAt }] of seen.entries()) {
    const daysSinceSeen = daysSince(exploredAt);

    if (isReviewDue(daysSinceSeen)) {
      candidates.push({
        topicId,
        title,
        daysSinceSeen,
        isForgotten: daysSinceSeen >= FORGOTTEN_THRESHOLD_DAYS,
        priority: computePriority(daysSinceSeen),
      });
    }
  }

  // Sort: highest priority (most overdue) first
  return candidates.sort((a, b) => b.priority - a.priority || b.daysSinceSeen - a.daysSinceSeen);
}

/**
 * Formats a short review-due label for a topic card.
 *
 * @param candidate - Spaced repetition candidate
 * @returns Human-readable label string
 */
export function formatReviewLabel(candidate: SpacedRepCandidate): string {
  if (candidate.isForgotten) return 'Review overdue';
  if (candidate.daysSinceSeen >= 7) return 'Review due';
  if (candidate.daysSinceSeen >= 3) return 'Due for review';
  return 'Quick review';
}
