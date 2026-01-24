/**
 * Tests for GitHub Activity API utilities.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculateActivityMetrics } from './activity';
import type { GitHubEvent } from './types';

// Helper to create test events
function createEvent(
  type: string,
  repo: string,
  daysAgo: number,
  payload?: GitHubEvent['payload']
): GitHubEvent {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    type,
    repo,
    createdAt: date.toISOString(),
    payload: payload || {},
  };
}

describe('calculateActivityMetrics', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('should return zero metrics for empty events array', () => {
    const metrics = calculateActivityMetrics([], 7);

    expect(metrics).toEqual({
      commits: 0,
      pullRequests: 0,
      reposUpdated: 0,
      activeRepos: [],
      periodDays: 7,
    });
  });

  it('should count commits from PushEvents', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1, { commits: [{}, {}, {}] }), // 3 commits
      createEvent('PushEvent', 'user/repo1', 2, { commits: [{}] }), // 1 commit
      createEvent('PushEvent', 'user/repo2', 3, { commits: [{}, {}] }), // 2 commits
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.commits).toBe(6);
  });

  it('should default to 1 commit when commits array is missing', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1, {}), // No commits array
      createEvent('PushEvent', 'user/repo1', 2, { commits: undefined }),
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.commits).toBe(2); // 1 + 1
  });

  it('should count only opened pull requests', () => {
    const events: GitHubEvent[] = [
      createEvent('PullRequestEvent', 'user/repo1', 1, { action: 'opened' }),
      createEvent('PullRequestEvent', 'user/repo1', 2, { action: 'opened' }),
      createEvent('PullRequestEvent', 'user/repo2', 3, { action: 'closed' }), // Not counted
      createEvent('PullRequestEvent', 'user/repo2', 4, { action: 'merged' }), // Not counted
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.pullRequests).toBe(2);
  });

  it('should count unique active repos', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1),
      createEvent('PushEvent', 'user/repo1', 2), // Same repo
      createEvent('PushEvent', 'user/repo2', 3),
      createEvent('IssueEvent', 'user/repo3', 4),
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.reposUpdated).toBe(3);
    expect(metrics.activeRepos).toEqual(['user/repo1', 'user/repo2', 'user/repo3']);
  });

  it('should filter events outside the specified period', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1, { commits: [{}] }), // Within 7 days
      createEvent('PushEvent', 'user/repo2', 5, { commits: [{}] }), // Within 7 days
      createEvent('PushEvent', 'user/repo3', 10, { commits: [{}] }), // Outside 7 days
      createEvent('PushEvent', 'user/repo4', 30, { commits: [{}] }), // Outside 7 days
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.commits).toBe(2);
    expect(metrics.reposUpdated).toBe(2);
    expect(metrics.activeRepos).toEqual(['user/repo1', 'user/repo2']);
  });

  it('should respect custom daysBack parameter', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1, { commits: [{}] }),
      createEvent('PushEvent', 'user/repo2', 10, { commits: [{}] }),
      createEvent('PushEvent', 'user/repo3', 20, { commits: [{}] }),
      createEvent('PushEvent', 'user/repo4', 40, { commits: [{}] }),
    ];

    const metrics30 = calculateActivityMetrics(events, 30);
    const metrics14 = calculateActivityMetrics(events, 14);

    expect(metrics30.commits).toBe(3);
    expect(metrics30.periodDays).toBe(30);
    expect(metrics14.commits).toBe(2);
    expect(metrics14.periodDays).toBe(14);
  });

  it('should handle mixed event types', () => {
    const events: GitHubEvent[] = [
      createEvent('PushEvent', 'user/repo1', 1, { commits: [{}, {}] }),
      createEvent('PullRequestEvent', 'user/repo1', 2, { action: 'opened' }),
      createEvent('IssueEvent', 'user/repo2', 3),
      createEvent('WatchEvent', 'user/repo3', 4),
      createEvent('ForkEvent', 'user/repo4', 5),
    ];

    const metrics = calculateActivityMetrics(events, 7);

    expect(metrics.commits).toBe(2);
    expect(metrics.pullRequests).toBe(1);
    expect(metrics.reposUpdated).toBe(4);
  });
});
