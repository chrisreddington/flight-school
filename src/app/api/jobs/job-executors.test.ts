/**
 * Tests for job executors
 */

import { describe, expect, it } from 'vitest';
import { buildRepositoryContextPrompt } from '@/lib/jobs/repository-context';

describe('Job Executors - Repository Context', () => {
  it('should add repository context when repos provided and GitHub tools enabled', () => {
    const repos = ['chrisreddington/trend-radar', 'chrisreddington/timestamp'];
    const prompt = 'What is the main purpose of this repository?';
    const hasGitHubCapability = true;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toContain('The user has selected these repositories as context.');
    expect(result).toContain('You MUST use GitHub MCP tools to look up live repository information before answering.');
    expect(result).toContain('Do NOT use local shell/filesystem tools or generic web tools.');
    expect(result).toContain('Selected repositories:');
    expect(result).toContain('- chrisreddington/trend-radar');
    expect(result).toContain('- chrisreddington/timestamp');
    expect(result).toContain('What is the main purpose of this repository?');
    expect(result.indexOf('Selected repositories:')).toBeLessThan(result.indexOf('What is the main purpose'));
  });

  it('should not add repository context when repos empty', () => {
    const repos: string[] = [];
    const prompt = 'What is the main purpose of this repository?';
    const hasGitHubCapability = true;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Selected repositories:');
  });

  it('should not add repository context when repos undefined', () => {
    const repos = undefined;
    const prompt = 'What is the main purpose of this repository?';
    const hasGitHubCapability = true;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Selected repositories:');
  });

  it('should not add repository context when GitHub tools disabled', () => {
    const repos = ['chrisreddington/trend-radar'];
    const prompt = 'What is the main purpose of this repository?';
    const hasGitHubCapability = false;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Selected repositories:');
  });

  it('should handle single repository', () => {
    const repos = ['chrisreddington/flight-school'];
    const prompt = 'Show me the README';
    const hasGitHubCapability = true;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toContain('The user has selected these repositories as context.');
    expect(result).toContain('- chrisreddington/flight-school');
    expect(result).toContain('Show me the README');
  });

  it('should handle multiple repositories with correct formatting', () => {
    const repos = ['owner1/repo1', 'owner2/repo2', 'owner3/repo3'];
    const prompt = 'Compare these repos';
    const hasGitHubCapability = true;

    const result = buildRepositoryContextPrompt(prompt, repos, hasGitHubCapability);

    expect(result).toContain('- owner1/repo1\n- owner2/repo2\n- owner3/repo3');
  });
});
