/**
 * GitHub Activity API
 *
 * Functions for fetching user activity events and calculating metrics.
 * All calculations are performed locally — no LLM overhead.
 */

import { getOctokit } from './client';
import { now } from '@/lib/utils/date-utils';
import type { ActivityMetrics, GitHubEvent } from './types';


/**
 * Fetch user events from GitHub, scoped to user-owned repos only.
 *
 * @remarks
 * Filters out events from organization repos to prevent private org data
 * from leaking into AI-generated content. Only events from repos where
 * the owner matches the authenticated user are included.
 *
 * @param username - GitHub username
 * @param perPage - Number of events to fetch
 * @returns Array of event data from user-owned repos only
 */
export async function getUserEvents(
  username: string,
  perPage = 100
): Promise<GitHubEvent[]> {
  const octokit = await getOctokit();
  const { data } = await octokit.rest.activity.listEventsForAuthenticatedUser({
    username,
    per_page: perPage,
  });

  return data
    .map((event) => ({
      type: event.type || 'Unknown',
      repo: event.repo?.name || 'unknown',
      createdAt: event.created_at || now(),
      payload: event.payload as GitHubEvent['payload'],
    }))
    // Exclude events from organization repos — only include user-owned repos
    .filter((event) => event.repo.split('/')[0] === username);
}

/**
 * Calculate activity metrics from events.
 * Performed locally without LLM involvement.
 *
 * @param events - Array of GitHub events
 * @param daysBack - Number of days to analyze
 * @returns Activity metrics
 */
export function calculateActivityMetrics(
  events: GitHubEvent[],
  daysBack = 7
): ActivityMetrics {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const recentEvents = events.filter((e) => new Date(e.createdAt) >= cutoff);

  const activeRepos = new Set<string>();
  let commits = 0;
  let pullRequests = 0;

  for (const event of recentEvents) {
    activeRepos.add(event.repo);

    if (event.type === 'PushEvent') {
      // Count commits in push events
      const commitCount = event.payload?.commits?.length ?? 1;
      commits += commitCount;
    } else if (event.type === 'PullRequestEvent') {
      if (event.payload?.action === 'opened') {
        pullRequests++;
      }
    }
  }

  return {
    commits,
    pullRequests,
    reposUpdated: activeRepos.size,
    activeRepos: Array.from(activeRepos),
    periodDays: daysBack,
  };
}
