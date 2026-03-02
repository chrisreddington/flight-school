/**
 * PR & Issue Work Pattern Analysis
 *
 * Analyzes the user's recent PRs and issues to identify work patterns:
 * bug-fixing, feature-building, documentation, testing, etc.
 *
 * Per metacognition research: surfacing work patterns creates self-awareness
 * of what the developer actually does vs what they think they do, enabling
 * more targeted skill development.
 */

import { getOctokit } from './client';
import { nowMs } from '@/lib/utils/date-utils';

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 1 hour */
const PATTERNS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Maximum items to analyze */
const MAX_ITEMS = 30;

// =============================================================================
// Types
// =============================================================================

/**
 * Summary of a developer's observable work patterns from recent PRs/issues.
 *
 * @remarks
 * Single-character key `wp` is used in CompactDeveloperProfile for token efficiency.
 * The `patterns` array contains labels like "bug-fix", "feature", "docs", "testing".
 */
export interface WorkPatternSummary {
  /** Dominant work patterns ordered by frequency */
  patterns: string[];
  /** Ratio of bugs fixed vs features built (0 = all features, 1 = all bugs) */
  bugRatio: number;
}

// =============================================================================
// Cache
// =============================================================================

interface CachedPatterns {
  summary: WorkPatternSummary;
  timestamp: number;
}

let patternsCache: CachedPatterns | null = null;

// =============================================================================
// Public API
// =============================================================================

/**
 * Analyzes recent PRs and issues to determine the user's work patterns.
 *
 * @remarks
 * Uses GitHub search API to find the user's recent activity. Classifies each
 * item using label matching and title keyword analysis. Cached for 1 hour.
 *
 * @param username - GitHub username
 * @returns Work pattern summary
 */
export async function analyzeWorkPatterns(
  username: string
): Promise<WorkPatternSummary> {
  if (patternsCache && nowMs() - patternsCache.timestamp < PATTERNS_CACHE_TTL_MS) {
    return patternsCache.summary;
  }

  const summary = await fetchAndAnalyze(username);
  patternsCache = { summary, timestamp: nowMs() };
  return summary;
}

// =============================================================================
// Internal helpers
// =============================================================================

const PATTERN_KEYWORDS: Record<string, string[]> = {
  'bug-fix': ['bug', 'fix', 'hotfix', 'patch', 'error', 'crash', 'broken', 'regression'],
  feature: ['feat', 'feature', 'add', 'new', 'implement', 'enhance', 'improve'],
  docs: ['doc', 'docs', 'readme', 'documentation', 'comment', 'changelog'],
  testing: ['test', 'spec', 'coverage', 'jest', 'vitest', 'playwright', 'e2e'],
  refactor: ['refactor', 'cleanup', 'clean', 'reorganize', 'restructure', 'simplify'],
  ci: ['ci', 'cd', 'pipeline', 'workflow', 'action', 'deploy', 'release'],
};

async function fetchAndAnalyze(username: string): Promise<WorkPatternSummary> {
  try {
    const octokit = await getOctokit();

    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${username} is:merged user:${username} sort:updated`,
      per_page: MAX_ITEMS,
    });

    const counts = new Map<string, number>(
      Object.keys(PATTERN_KEYWORDS).map((k) => [k, 0])
    );

    let bugCount = 0;
    let featureCount = 0;

    for (const item of response.data.items) {
      const text = `${item.title} ${(item.labels as Array<{ name?: string }>).map((l) => l.name ?? '').join(' ')}`.toLowerCase();

      for (const [pattern, keywords] of Object.entries(PATTERN_KEYWORDS)) {
        if (keywords.some((kw) => text.includes(kw))) {
          counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
        }
      }

      if (PATTERN_KEYWORDS['bug-fix'].some((kw) => text.includes(kw))) bugCount++;
      if (PATTERN_KEYWORDS.feature.some((kw) => text.includes(kw))) featureCount++;
    }

    const patterns = Array.from(counts.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern]) => pattern)
      .slice(0, 4);

    const total = bugCount + featureCount;
    const bugRatio = total > 0 ? Math.round((bugCount / total) * 100) / 100 : 0;

    return { patterns, bugRatio };
  } catch {
    return { patterns: [], bugRatio: 0 };
  }
}
