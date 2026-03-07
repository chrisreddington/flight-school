/**
 * Tests for GitHub client (token resolution)
 *
 * Tests token resolution priority: GITHUB_TOKEN env var → gh CLI fallback.
 * child_process is mocked so no actual `gh` binary is invoked.
 *
 * NOTE ON GITHUB_TOKEN ISOLATION IN GITHUB ACTIONS:
 * In GitHub Actions, GITHUB_TOKEN is write-once at the OS level — once set,
 * it cannot be reassigned or deleted. To work around this, each test gets a
 * fresh process.env object (via Object.defineProperty) so that GITHUB_TOKEN
 * starts unset and can be set exactly once per test.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process so execFile never calls the real `gh` binary.
// The mock calls the callback with an error, making execFileAsync reject
// and causing getTokenFromGhCli() to return null.
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const mockedExecFile = vi.fn(
    (_file: string, _args: string[], _opts: unknown, callback: unknown) => {
      const cb = typeof _opts === 'function'
        ? (_opts as (err: Error) => void)
        : (callback as (err: Error) => void);
      cb(new Error('gh CLI not available in tests'));
    }
  );
  const mod = { ...actual, execFile: mockedExecFile };
  return { ...mod, default: mod };
});

import {
  getGitHubToken,
  getOctokit,
  isGitHubConfigured,
  invalidateTokenCache,
  getAuthMethod,
} from './client';

// =============================================================================
// Environment isolation helpers
// =============================================================================

// Save original process.env so we can restore after each test.
const originalEnv = process.env;

/**
 * Replace process.env with a fresh copy for the current test.
 * This is necessary in GitHub Actions where GITHUB_TOKEN is write-once:
 * once set, the OS-level env var cannot be overwritten or deleted.
 * A fresh object sidesteps that restriction so each test starts clean.
 */
function freshEnv(): void {
  Object.defineProperty(process, 'env', {
    value: { ...originalEnv },
    writable: true,
    configurable: true,
  });
  // Remove GITHUB_TOKEN from the fresh copy so tests start with no token.
  delete (process.env as Record<string, unknown>).GITHUB_TOKEN;
}

/** Restore the original process.env reference. */
function restoreEnv(): void {
  Object.defineProperty(process, 'env', {
    value: originalEnv,
    writable: true,
    configurable: true,
  });
}

// =============================================================================
// Tests for GITHUB_TOKEN env var behavior
// =============================================================================

describe('GitHub Client - Environment Variable Auth', () => {
  beforeEach(() => {
    freshEnv();
    invalidateTokenCache();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('getGitHubToken with GITHUB_TOKEN', () => {
    it('should return GITHUB_TOKEN when set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token_123';
      const token = await getGitHubToken();
      expect(token).toBe('ghp_test_token_123');
    });

    it('should return null when GITHUB_TOKEN is not set and gh CLI fails', async () => {
      const token = await getGitHubToken();
      expect(token).toBeNull();
    });
  });

  describe('isGitHubConfigured', () => {
    it('should return true when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_configured_token';
      const configured = await isGitHubConfigured();
      expect(configured).toBe(true);
    });

    it('should return false when no auth is available', async () => {
      const configured = await isGitHubConfigured();
      expect(configured).toBe(false);
    });
  });

  describe('getOctokit', () => {
    it('should return Octokit instance when GITHUB_TOKEN is set', async () => {
      process.env.GITHUB_TOKEN = 'ghp_octokit_token';
      const octokit = await getOctokit();
      expect(octokit).toBeDefined();
      expect(octokit.rest).toBeDefined();
    });

    it('should return same cached Octokit instance on repeated calls', async () => {
      process.env.GITHUB_TOKEN = 'ghp_cached_token';
      const first = await getOctokit();
      const second = await getOctokit();
      expect(first).toBe(second);
    });

    it('should throw when no auth is available', async () => {
      await expect(getOctokit()).rejects.toThrow('GitHub authentication required');
    });
  });

  describe('invalidateTokenCache', () => {
    it('should force a new Octokit instance after cache is cleared', async () => {
      process.env.GITHUB_TOKEN = 'ghp_first_token';
      const first = await getOctokit();

      // Invalidate forces a fresh Octokit on the next call.
      invalidateTokenCache();
      const second = await getOctokit();

      expect(first).not.toBe(second);
    });
  });

  describe('getAuthMethod', () => {
    it('should return github-token when GITHUB_TOKEN is set', () => {
      process.env.GITHUB_TOKEN = 'ghp_test';
      expect(getAuthMethod()).toBe('github-token');
    });

    it('should return none when no auth is available', () => {
      expect(getAuthMethod()).toBe('none');
    });
  });
});

// =============================================================================
// Token format validation tests
// =============================================================================

describe('GitHub Token Format Validation', () => {
  beforeEach(() => {
    freshEnv();
    invalidateTokenCache();
  });

  afterEach(() => {
    restoreEnv();
  });

  it.each([
    ['ghp_personaltoken123', 'PAT'],
    ['gho_oauthtoken123456', 'OAuth'],
    ['ghs_servertoken12345', 'Server'],
    ['ghu_usertoken1234567', 'User'],
    ['github_pat_longertoken', 'Fine-grained PAT'],
  ])('should accept %s token format (%s)', async (token) => {
    process.env.GITHUB_TOKEN = token;
    const result = await getGitHubToken();
    expect(result).toBe(token);
  });
});
