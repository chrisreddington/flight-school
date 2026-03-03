/**
 * Tests for GitHub client (token resolution)
 * 
 * Tests the public API behavior with env vars.
 * The gh CLI fallback is harder to test due to promisify mocking complexity.
 *
 * NOTE: Tests that mock GITHUB_TOKEN require process.env to be writable.
 * In some environments (e.g. GitHub Actions sandboxes), GITHUB_TOKEN is a
 * write-protected OS-level env var and cannot be set from test code.
 * Those tests are skipped automatically in such environments.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGitHubToken, getOctokit, isGitHubConfigured, invalidateTokenCache } from './client';

/** Whether we can write to GITHUB_TOKEN in this environment. */
const canMockGithubToken = (() => {
  const backup = process.env.GITHUB_TOKEN;
  try {
    process.env.GITHUB_TOKEN = '__vitest_canary__';
    const writable = process.env.GITHUB_TOKEN === '__vitest_canary__';
    if (backup !== undefined) {
      process.env.GITHUB_TOKEN = backup;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
    return writable;
  } catch {
    return false;
  }
})();

// =============================================================================
// Tests for GITHUB_TOKEN env var behavior
// =============================================================================

describe.skipIf(!canMockGithubToken)('GitHub Client - Environment Variable Auth', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  describe('getGitHubToken with GITHUB_TOKEN', () => {
    it('should return GITHUB_TOKEN when set', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_123');
      
      const token = await getGitHubToken();
      expect(token).toBe('ghp_test_token_123');
    });
  });

  describe('isGitHubConfigured', () => {
    it('should return true when GITHUB_TOKEN is set', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_configured_token');
      
      const configured = await isGitHubConfigured();
      expect(configured).toBe(true);
    });
  });

  describe('getOctokit', () => {
    it('should return Octokit instance when GITHUB_TOKEN is set', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_octokit_token');
      
      const octokit = await getOctokit();
      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it('should return same cached Octokit instance', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_cached_token');
      
      const first = await getOctokit();
      const second = await getOctokit();
      
      expect(first).toBe(second);
    });
  });

  describe('invalidateTokenCache', () => {
    it('should clear Octokit cache requiring fresh instance', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_first_token');
      
      const first = await getOctokit();
      
      // Change token and invalidate
      vi.stubEnv('GITHUB_TOKEN', 'ghp_second_token');
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

describe.skipIf(!canMockGithubToken)('GitHub Token Format Validation', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    invalidateTokenCache();
  });

  it.each([
    ['ghp_personaltoken123', 'PAT'],
    ['gho_oauthtoken123456', 'OAuth'],
    ['ghs_servertoken12345', 'Server'],
    ['ghu_usertoken1234567', 'User'],
    ['github_pat_longertoken', 'Fine-grained PAT'],
  ])('should accept %s token format (%s)', async (token) => {
    vi.stubEnv('GITHUB_TOKEN', token);
    
    const result = await getGitHubToken();
    expect(result).toBe(token);
  });
});
