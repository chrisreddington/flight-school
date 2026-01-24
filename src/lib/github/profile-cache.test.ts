/**
 * Profile Cache Tests
 *
 * Tests for in-memory profile caching with TTL.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getCachedProfile, setCachedProfile } from './profile-cache';
import type { GitHubUser, GitHubRepo } from './types';

// Mock date utilities
const mockNowMs = vi.fn();
vi.mock('@/lib/utils/date-utils', () => ({
  nowMs: () => mockNowMs(),
}));

// =============================================================================
// Test Fixtures
// =============================================================================

const mockUser: GitHubUser = {
  login: 'testuser',
  id: 12345,
  avatar_url: 'https://avatars.githubusercontent.com/u/12345',
  name: 'Test User',
  bio: 'A test user',
  location: 'Test City',
  public_repos: 10,
  followers: 100,
  following: 50,
  created_at: '2020-01-01T00:00:00Z',
};

const mockRepos: GitHubRepo[] = [
  {
    id: 1,
    name: 'repo-1',
    full_name: 'testuser/repo-1',
    description: 'First repo',
    html_url: 'https://github.com/testuser/repo-1',
    language: 'TypeScript',
    stargazers_count: 10,
    forks_count: 2,
    updated_at: '2026-01-20T00:00:00Z',
    pushed_at: '2026-01-19T00:00:00Z',
    private: false,
    fork: false,
    topics: ['typescript'],
  },
];

// =============================================================================
// Tests
// =============================================================================

describe('Profile Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setCachedProfile', () => {
    it('should store profile data', () => {
      mockNowMs.mockReturnValue(1000);
      setCachedProfile(mockUser, mockRepos);

      mockNowMs.mockReturnValue(1001); // Just 1ms later
      const cached = getCachedProfile();

      expect(cached).not.toBeNull();
      expect(cached?.user).toEqual(mockUser);
      expect(cached?.repos).toEqual(mockRepos);
    });
  });

  describe('getCachedProfile', () => {
    it('should return null when cache is expired', () => {
      // Set cache at time 0
      mockNowMs.mockReturnValue(0);
      setCachedProfile(mockUser, []);
      
      // Expire the cache (6 minutes later)
      mockNowMs.mockReturnValue(6 * 60 * 1000);
      const cached = getCachedProfile();
      expect(cached).toBeNull();
    });

    it('should return cached data within TTL (5 minutes)', () => {
      const startTime = 1000;
      mockNowMs.mockReturnValue(startTime);
      setCachedProfile(mockUser, mockRepos);

      // 4 minutes later (within TTL)
      mockNowMs.mockReturnValue(startTime + 4 * 60 * 1000);
      const cached = getCachedProfile();

      expect(cached).not.toBeNull();
      expect(cached?.user.login).toBe('testuser');
    });

    it('should return null when cache is expired (after 5 minutes)', () => {
      const startTime = 1000;
      mockNowMs.mockReturnValue(startTime);
      setCachedProfile(mockUser, mockRepos);

      // 6 minutes later (beyond TTL)
      mockNowMs.mockReturnValue(startTime + 6 * 60 * 1000);
      const cached = getCachedProfile();

      expect(cached).toBeNull();
    });

    it('should return cached data at exactly TTL boundary', () => {
      const startTime = 1000;
      mockNowMs.mockReturnValue(startTime);
      setCachedProfile(mockUser, mockRepos);

      // Exactly 5 minutes minus 1ms (still valid)
      mockNowMs.mockReturnValue(startTime + 5 * 60 * 1000 - 1);
      const cached = getCachedProfile();

      expect(cached).not.toBeNull();
    });

    it('should return null at TTL + 1ms', () => {
      const startTime = 1000;
      mockNowMs.mockReturnValue(startTime);
      setCachedProfile(mockUser, mockRepos);

      // Exactly 5 minutes (expired)
      mockNowMs.mockReturnValue(startTime + 5 * 60 * 1000);
      const cached = getCachedProfile();

      expect(cached).toBeNull();
    });
  });

  describe('cache replacement', () => {
    it('should replace existing cache on new set', () => {
      mockNowMs.mockReturnValue(1000);
      setCachedProfile(mockUser, mockRepos);

      const newUser = { ...mockUser, login: 'newuser' };
      mockNowMs.mockReturnValue(2000);
      setCachedProfile(newUser, []);

      mockNowMs.mockReturnValue(2001);
      const cached = getCachedProfile();

      expect(cached?.user.login).toBe('newuser');
      expect(cached?.repos).toEqual([]);
    });

    it('should reset TTL on cache update', () => {
      const startTime = 1000;
      mockNowMs.mockReturnValue(startTime);
      setCachedProfile(mockUser, mockRepos);

      // 4 minutes later, update cache
      const updateTime = startTime + 4 * 60 * 1000;
      mockNowMs.mockReturnValue(updateTime);
      setCachedProfile(mockUser, mockRepos);

      // 4 more minutes later (8 total from start, but only 4 from update)
      mockNowMs.mockReturnValue(updateTime + 4 * 60 * 1000);
      const cached = getCachedProfile();

      expect(cached).not.toBeNull();
    });
  });
});
