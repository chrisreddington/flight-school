/**
 * GitHub API Module
 *
 * Direct GitHub API access using Octokit.
 * Use this for deterministic data fetching — no LLM overhead.
 *
 * For creative AI generation, use the Copilot SDK in `@/lib/copilot`.
 */

// Client
export { getOctokitForRequest, getOctokitForToken } from './client';

// User
export {
    calculateExperienceLevel,
    calculateYearsOnGitHub,
    getAuthenticatedUser
} from './user';

// Repositories
export { getLanguageStats, getUserRepositories } from './repos';

// Activity
export { calculateActivityMetrics, getUserEvents } from './activity';

// Language Colors
export { getLanguageColor } from './language-colors';
