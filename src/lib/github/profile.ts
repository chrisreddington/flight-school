/**
 * Profile Context Builder
 *
 * Builds a compact, token-efficient developer profile for LLM context.
 * Orchestrates data fetching from multiple GitHub APIs with caching.
 */

import { analyzeCommitPatterns, identifySkillGaps } from '@/lib/expertise';
import { calculateActivityMetrics, getUserEvents } from './activity';
import { getRepoReadmeSummary } from './readme';
import { getRepoLanguageBytes, getUserRepositories } from './repos';
import type {
    ActivitySummary,
    CompactDeveloperProfile,
    GitHubEvent,
    GitHubRepo,
    LanguageProficiency,
} from './types';
import { getAuthenticatedUser } from './user';

// =============================================================================
// Constants
// =============================================================================

/** Maximum repositories for deep inspection (Language + README) */
const MAX_DEEP_INSPECT_REPOS = 2;

/** Timeout for context generation (ms) */
const CONTEXT_TIMEOUT_MS = 1000;

/** Delimiter used in serialized context */
const FIELD_DELIMITER = '|';
const ARRAY_DELIMITER = ',';

// =============================================================================
// Public API
// =============================================================================

/**
 * Builds a compact developer profile for LLM context.
 *
 * @remarks
 * Uses a waterfall approach to minimize latency:
 * 1. Fetch profile, repos, events in parallel
 * 2. Pick top 2 repos for deep inspection
 * 3. Fetch language bytes and README in parallel for those 2 repos
 *
 * Uses `Promise.allSettled` for partial failure tolerance — if some
 * API calls fail, we still return useful context from successful calls.
 *
 * @param timeout - Maximum time for context generation (default: 1000ms)
 * @returns Compact developer profile optimized for <200 tokens
 *
 * @example
 * ```typescript
 * const profile = await buildCompactContext();
 * const serialized = serializeContext(profile);
 * // Use serialized in LLM prompt
 * ```
 */
export async function buildCompactContext(
  timeout = CONTEXT_TIMEOUT_MS
): Promise<CompactDeveloperProfile> {
  // Create abort signal for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Phase 1: Fetch base data in parallel
    const [userResult, reposResult, eventsResult] = await Promise.allSettled([
      getAuthenticatedUser(),
      getUserRepositories(),
      getAuthenticatedUserEvents(),
    ]);

    const user = userResult.status === 'fulfilled' ? userResult.value : null;
    const repos = reposResult.status === 'fulfilled' ? reposResult.value : [];
    const events = eventsResult.status === 'fulfilled' ? eventsResult.value : [];

    // Calculate metrics from base data
    const activityMetrics = calculateActivityMetrics(events, 7);

    // Aggregate topics across all repos
    const allTopics = aggregateTopics(repos);

    // Phase 2: Pick top 2 repos for deep inspection
    const topRepos = repos.slice(0, MAX_DEEP_INSPECT_REPOS);

    // Phase 3: Fetch deep data for top repos in parallel
    const deepDataPromises = topRepos.map(async (repo) => {
      const [owner, repoName] = repo.fullName.split('/');
      const [langResult, readmeResult] = await Promise.allSettled([
        getRepoLanguageBytes(owner, repoName),
        getRepoReadmeSummary(owner, repoName),
      ]);

      return {
        repoName: repo.fullName,
        languages: langResult.status === 'fulfilled' ? langResult.value : {},
        readme: readmeResult.status === 'fulfilled' ? readmeResult.value : null,
      };
    });

    const deepData = await Promise.all(deepDataPromises);

    // Aggregate language bytes from deep inspection
    const languageBytes = aggregateLanguageBytes(repos, deepData);

    // Extract README keywords
    const readmeKeywords = extractReadmeKeywords(deepData);

    // Identify skill gaps
    const skillGaps = identifySkillGaps(repos);

    // Analyze commit patterns
    const commitPattern = analyzeCommitPatterns(events);

    // Build activity summary
    const activitySummary: ActivitySummary = {
      c: activityMetrics.commits,
      pr: activityMetrics.pullRequests,
      d: activityMetrics.periodDays,
      r: activityMetrics.activeRepos.slice(0, 3).map(shortenRepoName),
    };

    return {
      u: user?.login || 'unknown',
      lp: languageBytes,
      t: allTopics.slice(0, 10),
      a: activitySummary,
      g: skillGaps.slice(0, 5),
      rd: readmeKeywords.slice(0, 10),
      cp: commitPattern,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Serializes a compact profile to a token-efficient string format.
 *
 * @remarks
 * Uses single-character keys and pipe delimiters for minimal tokens.
 * Format: `u:login|lp:TS:50000:45,JS:20000:25|t:react,api|...`
 *
 * @param profile - Compact developer profile
 * @returns Serialized string suitable for LLM context
 *
 * @example
 * ```typescript
 * const profile = await buildCompactContext();
 * const context = serializeContext(profile);
 * // "u:octocat|lp:TS:50000:45|t:react,api|a:15:3:7:my-app|g:testing,ci|rd:frontend|cp:conventional"
 * ```
 */
export function serializeContext(profile: CompactDeveloperProfile): string {
  const parts: string[] = [];

  // Username
  parts.push(`u:${escapeDelimiters(profile.u)}`);

  // Language proficiencies
  if (profile.lp.length > 0) {
    const lpParts = profile.lp.map((lp) =>
      `${escapeDelimiters(lp.n)}:${lp.b}:${lp.p}`
    );
    parts.push(`lp:${lpParts.join(ARRAY_DELIMITER)}`);
  }

  // Topics
  if (profile.t.length > 0) {
    parts.push(`t:${profile.t.map(escapeDelimiters).join(ARRAY_DELIMITER)}`);
  }

  // Activity
  parts.push(
    `a:${profile.a.c}:${profile.a.pr}:${profile.a.d}:${profile.a.r.map(escapeDelimiters).join(ARRAY_DELIMITER)}`
  );

  // Skill gaps
  if (profile.g.length > 0) {
    parts.push(`g:${profile.g.map(escapeDelimiters).join(ARRAY_DELIMITER)}`);
  }

  // README keywords
  if (profile.rd.length > 0) {
    parts.push(`rd:${profile.rd.map(escapeDelimiters).join(ARRAY_DELIMITER)}`);
  }

  // Commit pattern
  parts.push(`cp:${profile.cp}`);

  return parts.join(FIELD_DELIMITER);
}

/** Escapes delimiter characters in a string (internal). */
function escapeDelimiters(value: string): string {
  // Order matters: escape backslashes first, then other delimiters
  return value
    .replace(/\\/g, '\\B')
    .replace(/\|/g, '\\P')
    .replace(/,/g, '\\C')
    .replace(/:/g, '\\D');
}

// =============================================================================
// Internal Helpers
// =============================================================================

/** Fetches events for the authenticated user. */
async function getAuthenticatedUserEvents(): Promise<GitHubEvent[]> {
  try {
    const user = await getAuthenticatedUser();
    return getUserEvents(user.login);
  } catch {
    return [];
  }
}

/** Aggregates topics from all repositories. */
function aggregateTopics(repos: GitHubRepo[]): string[] {
  const topicCounts = new Map<string, number>();

  for (const repo of repos) {
    for (const topic of repo.topics || []) {
      const normalized = topic.toLowerCase();
      topicCounts.set(normalized, (topicCounts.get(normalized) || 0) + 1);
    }
  }

  return Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([topic]) => topic);
}

/** Aggregates language bytes from repo data and deep inspection. */
function aggregateLanguageBytes(
  repos: GitHubRepo[],
  deepData: Array<{ languages: Record<string, number> }>
): LanguageProficiency[] {
  const languageTotals = new Map<string, number>();

  // First, add data from deep inspection (byte-accurate)
  for (const data of deepData) {
    for (const [lang, bytes] of Object.entries(data.languages)) {
      languageTotals.set(lang, (languageTotals.get(lang) || 0) + bytes);
    }
  }

  // If deep inspection yielded no results, fall back to primary language counts
  if (languageTotals.size === 0) {
    for (const repo of repos) {
      if (repo.language) {
        // Estimate 10KB per repo as rough approximation
        languageTotals.set(
          repo.language,
          (languageTotals.get(repo.language) || 0) + 10000
        );
      }
    }
  }

  const total = Array.from(languageTotals.values()).reduce((a, b) => a + b, 0);

  return Array.from(languageTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, bytes]) => ({
      n: name,
      b: bytes,
      p: total > 0 ? Math.round((bytes / total) * 100) : 0,
    }));
}

/** Extracts unique keywords from README summaries. */
function extractReadmeKeywords(
  deepData: Array<{ readme: { keywords: string[] } | null }>
): string[] {
  const keywords = new Set<string>();

  for (const data of deepData) {
    if (data.readme?.keywords) {
      for (const kw of data.readme.keywords) {
        keywords.add(kw);
      }
    }
  }

  return Array.from(keywords);
}

/** Shortens a repo name by removing owner prefix if present. */
function shortenRepoName(repoName: string): string {
  const parts = repoName.split('/');
  return parts.length > 1 ? parts[1] : repoName;
}
