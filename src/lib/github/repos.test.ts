/**
 * Tests for GitHub Repos API utilities.
 */

import { describe, it, expect } from 'vitest';
import { getLanguageStats } from './repos';
import type { GitHubRepo } from './types';

// Helper to create test repos
function createRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    name: 'test-repo',
    fullName: 'user/test-repo',
    description: null,
    language: null,
    stargazersCount: 0,
    forksCount: 0,
    updatedAt: '2025-01-01T00:00:00Z',
    pushedAt: '2025-01-01T00:00:00Z',
    isPrivate: false,
    topics: [],
    ...overrides,
  };
}

describe('getLanguageStats', () => {
  it('should return empty array for empty repos list', () => {
    const stats = getLanguageStats([]);
    expect(stats).toEqual([]);
  });

  it('should return empty array when no repos have languages', () => {
    const repos = [
      createRepo({ language: null }),
      createRepo({ language: null }),
    ];

    const stats = getLanguageStats(repos);
    expect(stats).toEqual([]);
  });

  it('should count language occurrences and calculate percentages', () => {
    const repos = [
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'JavaScript' }),
      createRepo({ language: 'Python' }),
    ];

    const stats = getLanguageStats(repos);

    expect(stats).toHaveLength(3);
    expect(stats[0]).toEqual({
      name: 'TypeScript',
      percentage: 60, // 3 of 5
      color: expect.any(String),
    });
    expect(stats[1]).toEqual({
      name: 'JavaScript',
      percentage: 20, // 1 of 5
      color: expect.any(String),
    });
    expect(stats[2]).toEqual({
      name: 'Python',
      percentage: 20, // 1 of 5
      color: expect.any(String),
    });
  });

  it('should sort by frequency descending', () => {
    const repos = [
      createRepo({ language: 'Python' }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'JavaScript' }),
      createRepo({ language: 'JavaScript' }),
    ];

    const stats = getLanguageStats(repos);

    expect(stats[0].name).toBe('TypeScript'); // 3
    expect(stats[1].name).toBe('JavaScript'); // 2
    expect(stats[2].name).toBe('Python'); // 1
  });

  it('should respect limit parameter', () => {
    const repos = [
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'JavaScript' }),
      createRepo({ language: 'Python' }),
      createRepo({ language: 'Go' }),
      createRepo({ language: 'Rust' }),
      createRepo({ language: 'Java' }),
    ];

    const stats3 = getLanguageStats(repos, 3);
    const stats2 = getLanguageStats(repos, 2);

    expect(stats3).toHaveLength(3);
    expect(stats2).toHaveLength(2);
  });

  it('should use default limit of 5', () => {
    const repos = [
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'JavaScript' }),
      createRepo({ language: 'Python' }),
      createRepo({ language: 'Go' }),
      createRepo({ language: 'Rust' }),
      createRepo({ language: 'Java' }),
      createRepo({ language: 'C++' }),
    ];

    const stats = getLanguageStats(repos);

    expect(stats).toHaveLength(5);
  });

  it('should skip repos with null language', () => {
    const repos = [
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: null }),
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: null }),
    ];

    const stats = getLanguageStats(repos);

    expect(stats).toHaveLength(1);
    expect(stats[0].percentage).toBe(100); // 2 of 2 (ignoring nulls)
  });

  it('should include language colors from language-colors module', () => {
    const repos = [
      createRepo({ language: 'TypeScript' }),
      createRepo({ language: 'JavaScript' }),
    ];

    const stats = getLanguageStats(repos);

    // Colors should be hex strings
    expect(stats[0].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(stats[1].color).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
