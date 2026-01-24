/**
 * Challenge Parser
 *
 * Parses AI-generated challenge definitions from markdown/text responses.
 * Handles JSON extraction from code blocks and validation.
 */

import type { DailyChallenge } from '@/lib/focus/types';
import { nowMs } from '@/lib/utils/date-utils';
import { extractJSON } from '@/lib/utils/json-utils';

/**
 * Raw challenge structure from AI response.
 */
interface RawChallenge {
  title?: string;
  description?: string;
  difficulty?: string;
  language?: string;
  estimatedTime?: string;
  whyThisChallenge?: string[];
}

// JSON extraction logic moved to @/lib/utils/json-utils for reusability

/**
 * Validates difficulty level.
 */
function isValidDifficulty(
  difficulty: unknown
): difficulty is 'beginner' | 'intermediate' | 'advanced' {
  return (
    typeof difficulty === 'string' &&
    ['beginner', 'intermediate', 'advanced'].includes(difficulty)
  );
}

/**
 * Parses and validates a raw challenge object.
 *
 * @param raw - Raw parsed JSON
 * @returns Valid DailyChallenge or null
 */
function validateChallenge(raw: unknown): DailyChallenge | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const challenge = raw as RawChallenge;

  // Required fields
  if (!challenge.title || typeof challenge.title !== 'string') {
    return null;
  }
  if (!challenge.description || typeof challenge.description !== 'string') {
    return null;
  }
  if (!challenge.language || typeof challenge.language !== 'string') {
    return null;
  }

  // Validate difficulty (default to intermediate if missing)
  const difficulty = isValidDifficulty(challenge.difficulty)
    ? challenge.difficulty
    : 'intermediate';

  // Normalize estimatedTime
  const estimatedTime = challenge.estimatedTime || '30 minutes';

  // Normalize whyThisChallenge
  let whyThisChallenge: string[] = [];
  if (Array.isArray(challenge.whyThisChallenge)) {
    whyThisChallenge = challenge.whyThisChallenge.filter(
      (item) => typeof item === 'string'
    );
  }

  return {
    id: `custom-${nowMs()}-${Math.random().toString(36).substring(7)}`,
    title: challenge.title.trim(),
    description: challenge.description.trim(),
    difficulty,
    language: challenge.language.toLowerCase().trim(),
    estimatedTime,
    whyThisChallenge,
    isCustom: true,
  };
}

/**
 * Parses a generated challenge from AI response content.
 *
 * Handles multiple formats:
 * - JSON in ```json code blocks
 * - JSON in generic code blocks
 * - Raw JSON in response
 *
 * @param content - Full AI response content
 * @returns Parsed DailyChallenge or null if no valid challenge found
 */
export function parseGeneratedChallenge(content: string): DailyChallenge | null {
  if (!content || content.length === 0) {
    return null;
  }

  // Extract JSON from response using centralized utility
  const parsed = extractJSON<RawChallenge>(content, 'Challenge Generation');
  if (!parsed) {
    return null;
  }

  return validateChallenge(parsed);
}


