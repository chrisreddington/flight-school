/**
 * Skill Gap Analysis Module
 *
 * Analyzes developer GitHub activity to identify skill gaps and patterns.
 * Uses heuristics based on repository structure and commit messages.
 */

import type { GitHubEvent, GitHubRepo } from '@/lib/github/types';

/**
 * Known skill gap patterns for detection.
 *
 * @remarks
 * Each pattern maps a skill gap to detection criteria:
 * - `hasIndicator`: Files/topics that indicate the skill is present
 * - `missingIndicator`: Absence of these suggests a gap
 */
const SKILL_GAP_PATTERNS = {
  testing: {
    indicators: [
      'test', 'spec', 'jest', 'vitest', 'mocha', 'cypress', 'playwright',
      '.test.ts', '.spec.ts', '.test.js', '.spec.js', '__tests__',
    ],
    topicKeywords: ['testing', 'test', 'tdd', 'bdd'],
  },
  typescript: {
    indicators: ['tsconfig.json', '.ts', '.tsx'],
    topicKeywords: ['typescript', 'ts'],
  },
  ci: {
    indicators: ['.github/workflows', '.gitlab-ci', 'circle.yml', 'azure-pipelines'],
    topicKeywords: ['ci', 'cd', 'ci-cd', 'devops', 'github-actions'],
  },
  docker: {
    indicators: ['Dockerfile', 'docker-compose', '.dockerignore'],
    topicKeywords: ['docker', 'container', 'kubernetes', 'k8s'],
  },
  linting: {
    indicators: ['.eslintrc', 'eslint.config', '.prettierrc', 'biome.json'],
    topicKeywords: ['lint', 'eslint', 'prettier'],
  },
} as const;

type SkillGap = keyof typeof SKILL_GAP_PATTERNS;

/**
 * Identifies skill gaps based on repository analysis.
 *
 * Looks for missing patterns in repo names, topics, and common file structures.
 * A gap is identified when a developer uses a language but lacks associated tooling.
 *
 * @param repos - User's repositories to analyze
 * @returns Array of identified skill gaps (e.g., ["testing", "ci"])
 *
 * @example
 * ```typescript
 * const repos = await getUserRepositories();
 * const gaps = identifySkillGaps(repos);
 * // Returns: ["testing", "ci"] if repos lack test files and CI config
 * ```
 */
export function identifySkillGaps(repos: GitHubRepo[]): string[] {
  if (repos.length === 0) {
    return [];
  }

  const gaps: SkillGap[] = [];
  const allTopics = repos.flatMap((r) => r.topics || []).map((t) => t.toLowerCase());
  const allNames = repos.map((r) => r.name.toLowerCase());

  // Check each skill gap pattern
  for (const [skill, pattern] of Object.entries(SKILL_GAP_PATTERNS)) {
    const hasTopicIndicator = pattern.topicKeywords.some(
      (kw) => allTopics.includes(kw) || allNames.some((n) => n.includes(kw))
    );

    // If topic indicators are present, skill is likely known
    if (hasTopicIndicator) {
      continue;
    }

    // Check if any repo name suggests the skill (e.g., "my-project-tests")
    const hasNameIndicator = pattern.indicators.some((ind) =>
      allNames.some((n) => n.includes(ind.toLowerCase().replace(/[^a-z]/g, '')))
    );

    if (!hasNameIndicator) {
      gaps.push(skill as SkillGap);
    }
  }

  // Special case: If using JS but not TS, suggest TypeScript
  const hasJavaScript = repos.some((r) => r.language === 'JavaScript');
  const hasTypeScript = repos.some((r) => r.language === 'TypeScript');
  if (hasJavaScript && !hasTypeScript && !gaps.includes('typescript')) {
    gaps.push('typescript');
  }

  return gaps;
}

/**
 * Commit pattern types detected from commit messages.
 */
type CommitPattern = 'conventional' | 'freeform' | 'mixed';

/**
 * Conventional commit prefixes (semantic commit messages).
 */
const CONVENTIONAL_PREFIXES = [
  'feat:', 'fix:', 'docs:', 'style:', 'refactor:',
  'perf:', 'test:', 'build:', 'ci:', 'chore:', 'revert:',
  'feat(', 'fix(', 'docs(', 'chore(',
];

/**
 * Analyzes commit messages to detect conventional vs freeform patterns.
 *
 * Uses GitHub events (PushEvent) to extract commit messages without
 * additional API calls.
 *
 * @param events - GitHub activity events containing push payloads
 * @returns Detected commit pattern: 'conventional', 'freeform', or 'mixed'
 *
 * @example
 * ```typescript
 * const events = await getUserEvents(username);
 * const pattern = analyzeCommitPatterns(events);
 * // Returns: "conventional" if most commits use semantic prefixes
 * ```
 */
export function analyzeCommitPatterns(events: GitHubEvent[]): CommitPattern {
  const pushEvents = events.filter((e) => e.type === 'PushEvent');
  const commitMessages: string[] = [];

  for (const event of pushEvents) {
    const commits = event.payload?.commits || [];
    for (const commit of commits) {
      if (commit.message) {
        commitMessages.push(commit.message.toLowerCase());
      }
    }
  }

  if (commitMessages.length === 0) {
    return 'freeform';
  }

  let conventionalCount = 0;
  for (const msg of commitMessages) {
    const isConventional = CONVENTIONAL_PREFIXES.some((prefix) =>
      msg.startsWith(prefix.toLowerCase())
    );
    if (isConventional) {
      conventionalCount++;
    }
  }

  const ratio = conventionalCount / commitMessages.length;

  if (ratio >= 0.7) {
    return 'conventional';
  } else if (ratio >= 0.3) {
    return 'mixed';
  }
  return 'freeform';
}
