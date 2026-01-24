/**
 * Tests for GitHub validation utilities.
 *
 * Covers all validation rules and boundary conditions.
 */

import { describe, it, expect } from 'vitest';
import { validateRepoName } from './validation';

describe('validateRepoName', () => {
  describe('valid repository names', () => {
    it.each([
      { name: 'my-repo', desc: 'with hyphens' },
      { name: 'my_repo', desc: 'with underscores' },
      { name: 'myrepo123', desc: 'alphanumeric' },
      { name: 'a', desc: 'single character' },
      { name: 'A', desc: 'single uppercase' },
      { name: '123', desc: 'all numbers' },
      { name: 'my-repo_123', desc: 'mixed characters' },
      { name: 'a'.repeat(100), desc: 'exactly 100 characters' },
    ])('should accept $desc: "$name"', ({ name }) => {
      expect(validateRepoName(name)).toBeNull();
    });
  });

  describe('Rule 1: Required (non-empty)', () => {
    it.each([
      { input: '', desc: 'empty string' },
      { input: null as unknown as string, desc: 'null' },
      { input: undefined as unknown as string, desc: 'undefined' },
    ])('should reject $desc', ({ input }) => {
      expect(validateRepoName(input)).toBe('Repository name is required');
    });
  });

  describe('Rule 2: Max 100 characters', () => {
    it('should reject names longer than 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(validateRepoName(longName)).toBe(
        'Repository name must be 100 characters or less'
      );
    });

    it('should accept exactly 100 characters', () => {
      const maxName = 'a'.repeat(100);
      expect(validateRepoName(maxName)).toBeNull();
    });
  });

  describe('Rule 3: Only alphanumeric, hyphens, underscores', () => {
    it.each([
      { name: 'my repo', invalid: 'space' },
      { name: 'my.repo', invalid: 'dot' },
      { name: 'my/repo', invalid: 'slash' },
      { name: 'my@repo', invalid: '@ symbol' },
      { name: 'my#repo', invalid: 'hash' },
      { name: 'my$repo', invalid: 'dollar sign' },
      { name: 'émoji', invalid: 'accented character' },
      { name: '日本語', invalid: 'unicode characters' },
    ])('should reject name with $invalid', ({ name }) => {
      expect(validateRepoName(name)).toBe(
        'Repository name can only contain letters, numbers, hyphens, and underscores'
      );
    });
  });

  describe('Rule 4: Cannot start or end with hyphen', () => {
    it.each([
      { name: '-myrepo', desc: 'starting with hyphen' },
      { name: 'myrepo-', desc: 'ending with hyphen' },
      { name: '-myrepo-', desc: 'starting and ending with hyphen' },
      { name: '-', desc: 'single hyphen' },
    ])('should reject $desc', ({ name }) => {
      expect(validateRepoName(name)).toBe(
        'Repository name cannot start or end with a hyphen'
      );
    });

    it('should allow hyphens in the middle', () => {
      expect(validateRepoName('my-repo-name')).toBeNull();
    });

    it('should allow starting/ending with underscore', () => {
      expect(validateRepoName('_myrepo')).toBeNull();
      expect(validateRepoName('myrepo_')).toBeNull();
      expect(validateRepoName('_myrepo_')).toBeNull();
    });
  });

  describe('validation order', () => {
    it('should check required before length', () => {
      // Empty string should fail on required, not length
      expect(validateRepoName('')).toBe('Repository name is required');
    });

    it('should check length before character validation', () => {
      // 101 invalid chars - should fail on length first
      const tooLong = '.'.repeat(101);
      expect(validateRepoName(tooLong)).toBe(
        'Repository name must be 100 characters or less'
      );
    });

    it('should check characters before hyphen position', () => {
      // Invalid char that also starts with hyphen
      expect(validateRepoName('-.repo')).toBe(
        'Repository name can only contain letters, numbers, hyphens, and underscores'
      );
    });
  });
});
