/**
 * GitHub Repositories API
 *
 * Functions for fetching repository data and aggregating language statistics.
 * All calculations are performed locally — no LLM overhead.
 * Includes caching for performance optimization.
 */

import { getOctokit } from './client';
import { now, nowMs } from '@/lib/utils/date-utils';
import { getLanguageColor } from './language-colors';
import type {
    CreateRepoInput,
    CreatedRepo,
    GitHubRepo,
    LanguageStat,
} from './types';

// =============================================================================
// Repo State
// =============================================================================

export interface RepoState {
  exists: boolean;
  hasCommits: boolean;
}

// =============================================================================
// Repository Caching
// =============================================================================

/** Cache TTL: 5 minutes */
const REPOS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Cache TTL: 24 hours for language bytes (rarely changes) */
const LANGUAGE_BYTES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedRepos {
  repos: GitHubRepo[];
  timestamp: number;
}

interface CachedLanguageBytes {
  languages: Record<string, number>;
  timestamp: number;
}

let reposCache: CachedRepos | null = null;
const languageBytesCache = new Map<string, CachedLanguageBytes>();

/**
 * Fetch repositories for the authenticated user with caching.
 * Only fetches repos OWNED by the user (not org repos they have access to).
 * Paginates automatically to fetch ALL owned repositories.
 * 
 * Caches results for 5 minutes.
 *
 * @param options - Fetch options
 * @returns Array of repository data
 */
export async function getUserRepositories(options?: {
  sort?: 'created' | 'updated' | 'pushed' | 'full_name';
  perPage?: number;
  maxPages?: number;
}): Promise<GitHubRepo[]> {
  const nowTimestamp = nowMs();
  
  // Only use cache for default options (most common case)
  const isDefaultOptions = !options || (
    (!options.sort || options.sort === 'pushed') &&
    (!options.perPage || options.perPage === 100) &&
    (!options.maxPages || options.maxPages === 10)
  );
  
  if (isDefaultOptions && reposCache && (nowTimestamp - reposCache.timestamp) < REPOS_CACHE_TTL_MS) {
    return reposCache.repos;
  }
  
  // Fetch from API
  const octokit = await getOctokit();
  const perPage = options?.perPage || 100;
  const maxPages = options?.maxPages || 10; // Safety limit: 1000 repos max

  const allRepos: GitHubRepo[] = [];
  let page = 1;

  while (page <= maxPages) {
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: options?.sort || 'pushed',
      per_page: perPage,
      page,
      affiliation: 'owner', // Only repos owned by the user, not org repos
    });

    if (data.length === 0) {
      break; // No more repos
    }

    allRepos.push(
      ...data.map((repo) => ({
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        language: repo.language,
        stargazersCount: repo.stargazers_count ?? 0,
        forksCount: repo.forks_count ?? 0,
        updatedAt: repo.updated_at ?? now(),
        pushedAt: repo.pushed_at ?? now(),
        isPrivate: repo.private,
        topics: repo.topics || [],
      }))
    );

    if (data.length < perPage) {
      break; // Last page
    }

    page++;
  }
  
  if (isDefaultOptions) {
    reposCache = { repos: allRepos, timestamp: nowTimestamp };
  }
  
  return allRepos;
}

/**
 * Fetches byte-level language breakdown for a repository.
 *
 * Uses GitHub's repos.listLanguages API which returns bytes per language.
 * Results are cached for 24 hours per repository.
 *
 * @param owner - Repository owner (username or org)
 * @param repo - Repository name
 * @returns Map of language names to byte counts, or empty object on failure
 *
 * @example
 * ```typescript
 * const bytes = await getRepoLanguageBytes('octocat', 'hello-world');
 * // Returns: { TypeScript: 50000, JavaScript: 20000 }
 * ```
 */
export async function getRepoLanguageBytes(
  owner: string,
  repo: string
): Promise<Record<string, number>> {
  const cacheKey = `${owner}/${repo}`;
  const now = nowMs();

  // Check cache first
  const cached = languageBytesCache.get(cacheKey);
  if (cached && now - cached.timestamp < LANGUAGE_BYTES_CACHE_TTL_MS) {
    return cached.languages;
  }

  try {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.repos.listLanguages({ owner, repo });

    // Cache the result
    languageBytesCache.set(cacheKey, { languages: data, timestamp: now });
    return data;
  } catch {
    // Return empty object on failure (graceful degradation)
    return {};
  }
}

/**
 * Checks if a repository exists and whether it has commits.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Repository state (exists, hasCommits)
 */
export async function getRepositoryState(
  owner: string,
  repo: string
): Promise<RepoState> {
  const octokit = await getOctokit();

  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });

    try {
      await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${repoData.default_branch || 'main'}`,
      });
      return { exists: true, hasCommits: true };
    } catch {
      return { exists: true, hasCommits: false };
    }
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status;
    if (status === 404) {
      return { exists: false, hasCommits: false };
    }
    throw error;
  }
}

/**
 * Calculate language statistics from repository data.
 * Performed locally without LLM involvement.
 *
 * @param repos - Array of repositories
 * @param limit - Maximum number of languages to return
 * @returns Sorted language statistics with percentages
 */
export function getLanguageStats(repos: GitHubRepo[], limit = 5): LanguageStat[] {
  const counts: Record<string, number> = {};

  for (const repo of repos) {
    if (repo.language) {
      counts[repo.language] = (counts[repo.language] || 0) + 1;
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([name, count]) => ({
      name,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      color: getLanguageColor(name),
    }));
}

/**
 * Creates a new repository for the authenticated user.
 *
 * @param input - Repository creation parameters
 * @returns Created repository data with URLs
 * @throws Error if repository name is taken or invalid
 *
 * @example
 * ```typescript
 * const repo = await createRepository({
 *   name: 'learn-typescript-generics',
 *   description: 'Practice TypeScript generic patterns',
 *   isPrivate: false,
 *   autoInit: true,
 * });
 * console.log(`Created: ${repo.htmlUrl}`);
 * ```
 */
export async function createRepository(input: CreateRepoInput): Promise<CreatedRepo> {
  const octokit = await getOctokit();

  try {
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name: input.name,
      description: input.description,
      private: input.isPrivate ?? false,
      auto_init: input.autoInit ?? true,
    });

    // Add Flight School topics to the repository
    try {
      await octokit.rest.repos.replaceAllTopics({
        owner: data.owner.login,
        repo: data.name,
        names: ['flight-school', 'copilot-sdk'],
      });
    } catch {
      // Non-critical: topics are nice-to-have, don't fail repo creation
    }

    return {
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      isPrivate: data.private,
    };
  } catch (error: unknown) {
    // Re-throw with clearer message for common errors
    const status = (error as { status?: number })?.status;
    const message = error instanceof Error ? error.message : String(error);
    
    if (status === 422 && message.toLowerCase().includes('name already exists')) {
      throw new Error(`Repository name "${input.name}" already exists on your account`);
    }
    
    throw error;
  }
}

/**
 * Updates a file in a repository (creates if it doesn't exist).
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param path - File path within the repository
 * @param content - File content
 * @param message - Commit message
 * @param sha - SHA of the file being replaced (required for updates)
 * @returns Commit SHA of the update
 *
 * @example
 * ```typescript
 * await updateRepoFile(
 *   'chrisreddington',
 *   'my-repo',
 *   'README.md',
 *   '# My Project\n\nDescription here.',
 *   'Update README with project description'
 * );
 * ```
 */
export async function updateRepoFile(
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<{ commitSha: string }> {
  const octokit = await getOctokit();

  // Content must be base64 encoded
  const encodedContent = Buffer.from(content).toString('base64');

  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: encodedContent,
    sha,
  });

  return {
    commitSha: data.commit.sha ?? '',
  };
}

/**
 * Gets a file SHA with retry support for eventual consistency.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param path - File path within the repository
 * @param options - Retry configuration
 * @returns File SHA if it exists, null otherwise
 */
export async function getFileShaWithRetry(
  owner: string,
  repo: string,
  path: string,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<string | null> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const octokit = await getOctokit();

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
      });

      // getContent returns an array for directories
      if (Array.isArray(data)) {
        return null;
      }

      return data.sha;
    } catch (error) {
      // File doesn't exist
      if (error instanceof Error && error.message.includes('Not Found')) {
        if (attempt < maxRetries - 1) {
          const delayMs = baseDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        return null;
      }
      throw error;
    }
  }

  return null;
}
