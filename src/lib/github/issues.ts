/**
 * GitHub Issues API
 *
 * Functions for creating issues in user repositories.
 * Uses Octokit directly for deterministic API calls.
 */

import { getOctokit } from './client';
import type { CreateIssueInput, CreatedIssue } from './types';

export interface OpenIssueSummary {
  title: string;
  repo: string;
  labels: string[];
}

/**
 * Creates a new issue in the specified repository.
 *
 * @param input - Issue creation parameters
 * @returns Created issue data with URL
 * @throws Error if repository not found or user lacks permission
 *
 * @example
 * ```typescript
 * const issue = await createIssue({
 *   owner: 'chrisreddington',
 *   repo: 'my-project',
 *   title: 'Add error handling',
 *   body: '## Context\nImprove error handling in the API layer.',
 *   labels: ['enhancement', 'learning-goal'],
 * });
 * console.log(`Created: ${issue.htmlUrl}`);
 * ```
 */
export async function createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
  const octokit = await getOctokit();

  const { data } = await octokit.rest.issues.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    body: input.body,
    labels: input.labels,
  });

  return {
    number: data.number,
    title: data.title,
    htmlUrl: data.html_url,
    state: data.state,
  };
}

/**
 * Creates a learning goal issue with pre-filled template.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param topic - Learning topic to track
 * @param description - Optional description of the learning goal
 * @returns Created issue data
 *
 * @example
 * ```typescript
 * const issue = await createLearningGoalIssue(
 *   'chrisreddington',
 *   'my-project',
 *   'TypeScript Generics',
 *   'Learn advanced generic patterns for type-safe APIs'
 * );
 * ```
 */
export async function createLearningGoalIssue(
  owner: string,
  repo: string,
  topic: string,
  description?: string
): Promise<CreatedIssue> {
  const body = `## Learning Goal

**Topic**: ${topic}

${description ? `### Description\n${description}\n` : ''}
### Progress

- [ ] Research and understand the concept
- [ ] Practice with examples
- [ ] Apply in a real project
- [ ] Document learnings

---
*Created via Flight School*`;

  return createIssue({
    owner,
    repo,
    title: `📚 Learning Goal: ${topic}`,
    body,
    labels: ['learning-goal'],
  });
}

/** Fetches the user's recently updated open issues (gracefully returns [] on failure). */
export async function getOpenIssues(
  username: string,
  limit = 8
): Promise<OpenIssueSummary[]> {
  try {
    const octokit = await getOctokit();
    const { data } = await octokit.rest.search.issuesAndPullRequests({
      q: `is:open is:issue author:${username} user:${username}`,
      sort: 'updated',
      order: 'desc',
      per_page: limit,
    });

    return data.items.map((item) => ({
      title: item.title,
      repo: item.repository_url.split('/').pop() || '',
      labels: item.labels
        .map((label) => (typeof label === 'string' ? label : label.name))
        .filter((label): label is string => Boolean(label)),
    }));
  } catch {
    return [];
  }
}
