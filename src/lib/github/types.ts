/**
 * GitHub Feature Types
 *
 * Shared type definitions for the GitHub feature domain.
 * Centralized location for all GitHub-related types to avoid duplication.
 */

// ============================================================================
// Compact Profile Types (Token-Efficient)
// ============================================================================

/**
 * Language proficiency with byte-level detail.
 *
 * @remarks
 * Single-character keys minimize token usage in LLM context:
 * - `n`: language name
 * - `b`: bytes of code written
 * - `p`: percentage of total codebase
 */
export interface LanguageProficiency {
  /** Language name (e.g., "TypeScript") */
  n: string;
  /** Bytes of code in this language across all repos */
  b: number;
  /** Percentage of total codebase (0-100) */
  p: number;
}

/**
 * Activity metrics summary for a time period.
 *
 * @remarks
 * Single-character keys minimize token usage:
 * - `c`: commit count
 * - `pr`: pull request count
 * - `d`: days in period
 * - `r`: recently active repo names
 */
export interface ActivitySummary {
  /** Commit count in period */
  c: number;
  /** Pull request count in period */
  pr: number;
  /** Period length in days */
  d: number;
  /** Recently active repository names (max 3) */
  r: string[];
}

/**
 * Compact developer profile optimized for LLM context.
 *
 * @remarks
 * Designed for <200 tokens total. Uses single-character keys:
 * - `u`: username
 * - `lp`: language proficiencies (top 5)
 * - `t`: repository topics (aggregated)
 * - `a`: activity summary
 * - `g`: identified skill gaps
 * - `rd`: README-derived keywords (from top repos)
 * - `cp`: commit pattern (conventional vs freeform)
 *
 * @example
 * ```typescript
 * const profile: CompactDeveloperProfile = {
 *   u: "octocat",
 *   lp: [{ n: "TypeScript", b: 50000, p: 45 }],
 *   t: ["react", "nodejs"],
 *   a: { c: 15, pr: 3, d: 7, r: ["my-app"] },
 *   g: ["testing", "ci"],
 *   rd: ["api", "frontend"],
 *   cp: "conventional"
 * };
 * ```
 */
export interface CompactDeveloperProfile {
  /** Username */
  u: string;
  /** Language proficiencies (top 5 by bytes) */
  lp: LanguageProficiency[];
  /** Aggregated repository topics */
  t: string[];
  /** Activity summary for last 7 days */
  a: ActivitySummary;
  /** Identified skill gaps (e.g., "testing", "typescript", "ci") */
  g: string[];
  /** README-derived keywords from top repos */
  rd: string[];
  /** Commit pattern: conventional commits vs freeform */
  cp: 'conventional' | 'freeform' | 'mixed';
}

// ============================================================================
// User Types
// ============================================================================

/**
 * GitHub user profile data
 */
export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  publicRepos: number;
  followers: number;
  following: number;
  createdAt: string;
}

// ============================================================================
// Repository Types
// ============================================================================

/**
 * Repository data structure
 */
export interface GitHubRepo {
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  updatedAt: string;
  pushedAt: string;
  isPrivate: boolean;
  topics: string[];
}

/**
 * Language statistics
 */
export interface LanguageStat {
  name: string;
  percentage: number;
  color: string;
}

/**
 * Repository creation input parameters
 */
export interface CreateRepoInput {
  /** Repository name (required) */
  name: string;
  /** Repository description */
  description?: string;
  /** Whether the repository is private */
  isPrivate?: boolean;
  /** Initialize with a README */
  autoInit?: boolean;
}

/**
 * Created repository response data
 */
export interface CreatedRepo {
  /** Repository name */
  name: string;
  /** Full repository name (owner/repo) */
  fullName: string;
  /** Full HTML URL to the repository */
  htmlUrl: string;
  /** Clone URL (HTTPS) */
  cloneUrl: string;
  /** Whether the repository is private */
  isPrivate: boolean;
}

// ============================================================================
// Activity Types
// ============================================================================

/**
 * GitHub event data structure
 */
export interface GitHubEvent {
  type: string;
  repo: string;
  createdAt: string;
  payload?: {
    action?: string;
    ref?: string;
    commits?: Array<{ sha: string; message: string }>;
  };
}

/**
 * Activity metrics for a time period
 */
export interface ActivityMetrics {
  commits: number;
  pullRequests: number;
  reposUpdated: number;
  activeRepos: string[];
  periodDays: number;
}

// ============================================================================
// Issue Types
// ============================================================================

/**
 * Issue creation input parameters
 */
export interface CreateIssueInput {
  /** Repository owner (username or org) */
  owner: string;
  /** Repository name */
  repo: string;
  /** Issue title */
  title: string;
  /** Issue body (markdown supported) */
  body?: string;
  /** Labels to apply */
  labels?: string[];
}

/**
 * Created issue response data
 */
export interface CreatedIssue {
  /** Issue number */
  number: number;
  /** Issue title */
  title: string;
  /** Full HTML URL to the issue */
  htmlUrl: string;
  /** Issue state (open/closed) */
  state: string;
}
