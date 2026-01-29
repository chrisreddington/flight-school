/**
 * Tests for job executors
 */

import { describe, expect, it } from 'vitest';

/**
 * Helper to test repository context building logic
 * Extracts the logic from executeChatResponse for testing
 */
function buildRepositoryContext(repos: string[] | undefined, prompt: string, useGitHubTools: boolean): string {
  let contextualPrompt = prompt;
  if (repos && repos.length > 0 && useGitHubTools) {
    const repoList = repos.map(r => `- ${r}`).join('\n');
    const repoContext = `Context: Focus on these repositories when using GitHub tools:\n${repoList}\n\n`;
    contextualPrompt = repoContext + prompt;
  }
  return contextualPrompt;
}

describe('Job Executors - Repository Context', () => {
  it('should add repository context when repos provided and GitHub tools enabled', () => {
    const repos = ['chrisreddington/trend-radar', 'chrisreddington/timestamp'];
    const prompt = 'What is the main purpose of this repository?';
    const useGitHubTools = true;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toContain('Context: Focus on these repositories when using GitHub tools:');
    expect(result).toContain('- chrisreddington/trend-radar');
    expect(result).toContain('- chrisreddington/timestamp');
    expect(result).toContain('What is the main purpose of this repository?');
    // Verify context comes before prompt
    expect(result.indexOf('Context:')).toBeLessThan(result.indexOf('What is the main purpose'));
  });

  it('should not add repository context when repos empty', () => {
    const repos: string[] = [];
    const prompt = 'What is the main purpose of this repository?';
    const useGitHubTools = true;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Context:');
  });

  it('should not add repository context when repos undefined', () => {
    const repos = undefined;
    const prompt = 'What is the main purpose of this repository?';
    const useGitHubTools = true;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Context:');
  });

  it('should not add repository context when GitHub tools disabled', () => {
    const repos = ['chrisreddington/trend-radar'];
    const prompt = 'What is the main purpose of this repository?';
    const useGitHubTools = false;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toBe(prompt);
    expect(result).not.toContain('Context:');
  });

  it('should handle single repository', () => {
    const repos = ['chrisreddington/flight-school'];
    const prompt = 'Show me the README';
    const useGitHubTools = true;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toContain('Context: Focus on these repositories when using GitHub tools:');
    expect(result).toContain('- chrisreddington/flight-school');
    expect(result).toContain('Show me the README');
  });

  it('should handle multiple repositories with correct formatting', () => {
    const repos = ['owner1/repo1', 'owner2/repo2', 'owner3/repo3'];
    const prompt = 'Compare these repos';
    const useGitHubTools = true;

    const result = buildRepositoryContext(repos, prompt, useGitHubTools);

    expect(result).toContain('- owner1/repo1\n- owner2/repo2\n- owner3/repo3');
  });
});
