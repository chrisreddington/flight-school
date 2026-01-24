/**
 * Tests for skill gap analysis and commit pattern detection.
 *
 * Covers heuristic-based skill detection from GitHub activity.
 */

import { describe, it, expect } from 'vitest';
import { identifySkillGaps, analyzeCommitPatterns } from './skills';
import type { GitHubRepo, GitHubEvent } from '@/lib/github/types';

// Factory for creating test repos
function createRepo(overrides: Partial<GitHubRepo> = {}): GitHubRepo {
  return {
    id: 1,
    name: 'test-repo',
    full_name: 'user/test-repo',
    html_url: 'https://github.com/user/test-repo',
    description: null,
    language: null,
    topics: [],
    stargazers_count: 0,
    forks_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
    private: false,
    fork: false,
    ...overrides,
  };
}

// Factory for creating push events with commits
function createPushEvent(commits: Array<{ message: string }>): GitHubEvent {
  return {
    id: '1',
    type: 'PushEvent',
    created_at: '2026-01-01T00:00:00Z',
    repo: { id: 1, name: 'user/repo', url: 'https://api.github.com/repos/user/repo' },
    payload: { commits },
  };
}

describe('identifySkillGaps', () => {
  describe('empty/minimal repos', () => {
    it('should return empty array for no repos', () => {
      expect(identifySkillGaps([])).toEqual([]);
    });

    it('should detect all gaps for repos with no indicators', () => {
      const repos = [createRepo({ name: 'generic-app' })];
      const gaps = identifySkillGaps(repos);

      expect(gaps).toContain('testing');
      expect(gaps).toContain('ci');
      expect(gaps).toContain('docker');
      expect(gaps).toContain('linting');
    });
  });

  describe('testing skill detection', () => {
    it.each([
      { topic: 'testing', desc: 'testing topic' },
      { topic: 'test', desc: 'test topic' },
      { topic: 'tdd', desc: 'tdd topic' },
      { topic: 'bdd', desc: 'bdd topic' },
    ])('should not flag testing gap with $desc', ({ topic }) => {
      const repos = [createRepo({ topics: [topic] })];
      expect(identifySkillGaps(repos)).not.toContain('testing');
    });

    it('should not flag testing gap for repo named with test indicators', () => {
      const repos = [createRepo({ name: 'my-project-tests' })];
      expect(identifySkillGaps(repos)).not.toContain('testing');
    });
  });

  describe('CI/CD skill detection', () => {
    it.each([
      { topic: 'ci', desc: 'ci topic' },
      { topic: 'cd', desc: 'cd topic' },
      { topic: 'github-actions', desc: 'github-actions topic' },
      { topic: 'devops', desc: 'devops topic' },
    ])('should not flag CI gap with $desc', ({ topic }) => {
      const repos = [createRepo({ topics: [topic] })];
      expect(identifySkillGaps(repos)).not.toContain('ci');
    });
  });

  describe('Docker skill detection', () => {
    it.each([
      { topic: 'docker', desc: 'docker topic' },
      { topic: 'container', desc: 'container topic' },
      { topic: 'kubernetes', desc: 'kubernetes topic' },
      { topic: 'k8s', desc: 'k8s topic' },
    ])('should not flag Docker gap with $desc', ({ topic }) => {
      const repos = [createRepo({ topics: [topic] })];
      expect(identifySkillGaps(repos)).not.toContain('docker');
    });
  });

  describe('TypeScript detection', () => {
    it('should suggest TypeScript for JavaScript-only developers', () => {
      const repos = [createRepo({ language: 'JavaScript' })];
      expect(identifySkillGaps(repos)).toContain('typescript');
    });

    it('should not suggest TypeScript if already using it', () => {
      const repos = [
        createRepo({ language: 'JavaScript' }),
        createRepo({ language: 'TypeScript', topics: ['typescript'] }),
      ];
      // With 'typescript' topic, the gap detection skips it
      expect(identifySkillGaps(repos)).not.toContain('typescript');
    });

    it('should still suggest TypeScript for non-JS developers without TS indicators', () => {
      // The implementation always adds typescript if no indicator detected
      // regardless of language - this is documenting actual behavior
      const repos = [createRepo({ language: 'Python' })];
      const gaps = identifySkillGaps(repos);
      // TypeScript gets added because there's no TypeScript indicator
      expect(gaps).toContain('typescript');
    });

    it('should not suggest TypeScript when typescript topic exists', () => {
      const repos = [createRepo({ language: 'Python', topics: ['typescript'] })];
      expect(identifySkillGaps(repos)).not.toContain('typescript');
    });
  });

  describe('linting skill detection', () => {
    it.each([
      { topic: 'lint', desc: 'lint topic' },
      { topic: 'eslint', desc: 'eslint topic' },
      { topic: 'prettier', desc: 'prettier topic' },
    ])('should not flag linting gap with $desc', ({ topic }) => {
      const repos = [createRepo({ topics: [topic] })];
      expect(identifySkillGaps(repos)).not.toContain('linting');
    });
  });

  describe('multiple repos aggregation', () => {
    it('should aggregate topics across all repos', () => {
      const repos = [
        createRepo({ name: 'app-1', topics: ['testing'] }),
        createRepo({ name: 'app-2', topics: ['docker'] }),
        createRepo({ name: 'app-3', topics: ['ci'] }),
      ];
      const gaps = identifySkillGaps(repos);

      expect(gaps).not.toContain('testing');
      expect(gaps).not.toContain('docker');
      expect(gaps).not.toContain('ci');
      expect(gaps).toContain('linting'); // Still missing
    });
  });
});

describe('analyzeCommitPatterns', () => {
  describe('conventional commits', () => {
    it.each([
      'feat: add new feature',
      'fix: resolve bug',
      'docs: update readme',
      'style: format code',
      'refactor: clean up logic',
      'perf: optimize query',
      'test: add unit tests',
      'build: update deps',
      'ci: add workflow',
      'chore: maintenance',
      'revert: undo change',
      'feat(scope): scoped feature',
      'fix(api): scoped fix',
    ])('should recognize "%s" as conventional', (message) => {
      const events = [createPushEvent([{ message }])];
      expect(analyzeCommitPatterns(events)).toBe('conventional');
    });
  });

  describe('freeform commits', () => {
    it('should return freeform for non-conventional messages', () => {
      const events = [
        createPushEvent([
          { message: 'Updated the code' },
          { message: 'Fixed stuff' },
          { message: 'WIP' },
        ]),
      ];
      expect(analyzeCommitPatterns(events)).toBe('freeform');
    });

    it('should return freeform for empty events', () => {
      expect(analyzeCommitPatterns([])).toBe('freeform');
    });

    it('should return freeform for events with no commits', () => {
      const events: GitHubEvent[] = [
        {
          id: '1',
          type: 'PushEvent',
          created_at: '2026-01-01T00:00:00Z',
          repo: { id: 1, name: 'user/repo', url: '' },
          payload: { commits: [] },
        },
      ];
      expect(analyzeCommitPatterns(events)).toBe('freeform');
    });
  });

  describe('mixed commits', () => {
    it('should return mixed for 30-70% conventional ratio', () => {
      const events = [
        createPushEvent([
          { message: 'feat: new feature' },
          { message: 'fix: bug fix' },
          { message: 'random update' },
          { message: 'more changes' },
          { message: 'wip' },
        ]),
      ];
      // 2/5 = 40% conventional = mixed
      expect(analyzeCommitPatterns(events)).toBe('mixed');
    });

    it('should return conventional for ≥70% ratio', () => {
      const events = [
        createPushEvent([
          { message: 'feat: one' },
          { message: 'fix: two' },
          { message: 'docs: three' },
          { message: 'random' },
        ]),
      ];
      // 3/4 = 75% conventional
      expect(analyzeCommitPatterns(events)).toBe('conventional');
    });

    it('should return freeform for <30% ratio', () => {
      const events = [
        createPushEvent([
          { message: 'feat: one' },
          { message: 'random update' },
          { message: 'more changes' },
          { message: 'wip' },
          { message: 'stuff' },
        ]),
      ];
      // 1/5 = 20% conventional
      expect(analyzeCommitPatterns(events)).toBe('freeform');
    });
  });

  describe('non-push events', () => {
    it('should ignore non-PushEvent types', () => {
      const events: GitHubEvent[] = [
        {
          id: '1',
          type: 'IssueCommentEvent',
          created_at: '2026-01-01T00:00:00Z',
          repo: { id: 1, name: 'user/repo', url: '' },
          payload: {},
        },
        createPushEvent([{ message: 'feat: actual commit' }]),
      ];
      expect(analyzeCommitPatterns(events)).toBe('conventional');
    });
  });

  describe('case insensitivity', () => {
    it('should recognize uppercase conventional prefixes', () => {
      const events = [
        createPushEvent([
          { message: 'FEAT: uppercase' },
          { message: 'FIX: also uppercase' },
        ]),
      ];
      expect(analyzeCommitPatterns(events)).toBe('conventional');
    });
  });
});
