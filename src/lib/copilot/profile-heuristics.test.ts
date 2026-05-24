/**
 * Tests for the token-boundary `needsGitHubCapability` predicate.
 * Regression-focused: must reject the `"report"` → `"repo"` substring
 * false-positive that the previous `includes`-based matcher allowed.
 */

import { describe, expect, it } from 'vitest';

import { needsGitHubCapability } from './profile-heuristics';

describe('needsGitHubCapability', () => {
  it.each<{ prompt: string; expected: boolean }>([
    // True positives — clear GitHub vocabulary
    { prompt: 'list my repos', expected: true },
    { prompt: 'show repositories', expected: true },
    { prompt: 'open the latest pull request', expected: true },
    { prompt: 'find PRs by author', expected: true },
    { prompt: 'show open issues', expected: true },
    { prompt: 'inspect the last commit', expected: true },
    { prompt: 'list branches', expected: true },
    { prompt: 'search code for handleError', expected: true },
    { prompt: 'what is on my GitHub', expected: true },
    { prompt: 'one repository please', expected: true },

    // Substring false-positive regressions — must stay false
    { prompt: 'write a quarterly report', expected: false },
    { prompt: 'reporter notes', expected: false },
    { prompt: 'we issued a refund', expected: false },
    { prompt: 'how does branching factor work in trees', expected: false },
    { prompt: 'plain hello', expected: false },
    { prompt: 'explain closures', expected: false },
  ])('"$prompt" → $expected', ({ prompt, expected }) => {
    expect(needsGitHubCapability(prompt)).toBe(expected);
  });
});
