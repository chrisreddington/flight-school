/**
 * Tests for GitHub client (token resolution)
 * 
 * Tests the public API behavior with env vars.
 * The gh CLI fallback is harder to test due to promisify mocking complexity.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Tests for GITHUB_TOKEN env var behavior
// =============================================================================

describe('GitHub Client - Environment Variable Auth', () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  describe('getGitHubToken with GITHUB_TOKEN', () => {
    it('should return GITHUB_TOKEN when set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token_123';
      
      // Dynamic import to get fresh module state
      const { getGitHubToken, invalidateTokenCache } = await import('./client');
      invalidateTokenCache();
      
      const token = await getGitHubToken();
      expect(token).toBe('ghp_test_token_123');
    });
  });

  describe('isGitHubConfigured', () => {
    it('should return true when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_configured_token';
      
      const { isGitHubConfigured, invalidateTokenCache } = await import('./client');
      invalidateTokenCache();
      
      const configured = await isGitHubConfigured();
      expect(configured).toBe(true);
    });
  });

  describe('getOctokit', () => {
    it('should return Octokit instance when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_octokit_token';
      
      const { getOctokit, invalidateTokenCache } = await import('./client');
      invalidateTokenCache();
      
      const octokit = await getOctokit();
      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it('should return same cached Octokit instance', async () => {
      process.env.GITHUB_TOKEN = 'ghp_cached_token';
      
      const { getOctokit, invalidateTokenCache } = await import('./client');
      invalidateTokenCache();
      
      const first = await getOctokit();
      const second = await getOctokit();
      
      expect(first).toBe(second);
    });
  });

  describe('invalidateTokenCache', () => {
    it('should clear Octokit cache requiring fresh instance', async () => {
      process.env.GITHUB_TOKEN = 'ghp_first_token';
      
      const { getOctokit, invalidateTokenCache } = await import('./client');
      invalidateTokenCache();
      
      const first = await getOctokit();
      
      // Change token and invalidate
      process.env.GITHUB_TOKEN = 'ghp_second_token';
      invalidateTokenCache();
      
      const second = await getOctokit();
      
      // Different instances after invalidation
      expect(first).not.toBe(second);
    });
  });
});

// =============================================================================
// Token format validation tests
// =============================================================================

describe('GitHub Token Format Validation', () => {
  const originalEnv = process.env.GITHUB_TOKEN;

  afterEach(() => {
    if (originalEnv) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    vi.resetModules();
  });

  it.each([
    ['ghp_personaltoken123', 'PAT'],
    ['gho_oauthtoken123456', 'OAuth'],
    ['ghs_servertoken12345', 'Server'],
    ['ghu_usertoken1234567', 'User'],
    ['github_pat_longertoken', 'Fine-grained PAT'],
  ])('should accept %s token format (%s)', async (token) => {
    process.env.GITHUB_TOKEN = token;
    
    const { getGitHubToken, invalidateTokenCache } = await import('./client');
    invalidateTokenCache();
    
    const result = await getGitHubToken();
    expect(result).toBe(token);
  });
});
