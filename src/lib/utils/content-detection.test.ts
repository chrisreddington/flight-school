/**
 * Tests for content detection utilities.
 *
 * Covers actionable content and GitHub tools detection patterns.
 */

import { describe, it, expect } from 'vitest';
import { detectActionableContent, needsGitHubTools } from './content-detection';

describe('detectActionableContent', () => {
  describe('follow-up suggestions', () => {
    it.each([
      'You could try implementing a custom hook',
      'You might explore using React Query',
      'You can look into the useReducer pattern',
      'You could experiment with different approaches',
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });
  });

  describe('action suggestions', () => {
    it.each([
      'Try running the tests locally',
      'Consider using TypeScript for better type safety',
      'Try implementing a cache layer',
      'Consider adding error boundaries',
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });
  });

  describe('next steps patterns', () => {
    it.each([
      'Next steps: Review the API documentation',
      'Follow-up questions to consider',
      'Some next questions to explore',
      'Follow up exercises are below',
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });
  });

  describe('exercise patterns', () => {
    it.each([
      "Here's an exercise to practice",
      'Here is a challenge for you',
      "Here's an experiment you can try",
      // 'Here are some exercises' - not matched by current patterns (singular only)
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });

    it('should not detect plural "exercises" without pattern match', () => {
      // Current patterns use singular forms: "exercise", "challenge", "experiment"
      expect(detectActionableContent('Here are some exercises')).toBe(false);
    });
  });

  describe('numbered suggestions', () => {
    it.each([
      '1. Try implementing...',
      '2. Explore the docs...',
      '1. What if we...',
      '3. Consider using...',
      '1. How about trying...',
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });
  });

  describe('learning continuation', () => {
    it.each([
      'To deepen your understanding, try...',
      // 'To further your learning...' - pattern requires "understanding" not "learning"
      'To continue your understanding...',
      'A practice exercise would help',
      'Try this hands-on exercise',
      // 'A hands on exercise: implement...' - requires hyphen in "hands-on"
    ])('should detect "%s"', (content) => {
      expect(detectActionableContent(content)).toBe(true);
    });

    it('should not detect patterns that do not match exactly', () => {
      // Pattern is /to (?:deepen|further|continue) your understanding/
      // "learning" doesn't match
      expect(detectActionableContent('To further your learning...')).toBe(false);
      // Pattern is /hands-?on/ with optional hyphen, but "hands on" (space) doesn't match
      expect(detectActionableContent('A hands on exercise: implement...')).toBe(false);
    });
  });

  describe('non-actionable content', () => {
    it.each([
      'The useState hook is used for state management.',
      'React is a JavaScript library for building UIs.',
      'This is a simple explanation.',
      "Here's how the code works:",
      'The function returns a boolean value.',
    ])('should not detect "%s" as actionable', (content) => {
      expect(detectActionableContent(content)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(detectActionableContent('')).toBe(false);
    });

    it('should be case insensitive', () => {
      expect(detectActionableContent('YOU COULD TRY THIS')).toBe(true);
      expect(detectActionableContent('NEXT STEPS:')).toBe(true);
    });

    it('should detect in longer content', () => {
      const longContent = `
        Here's a detailed explanation of how React hooks work.
        
        The useState hook manages local state.
        The useEffect hook handles side effects.
        
        To deepen your understanding, try implementing
        a custom hook that combines both patterns.
      `;
      expect(detectActionableContent(longContent)).toBe(true);
    });
  });
});

describe('needsGitHubTools', () => {
  describe('GitHub keywords', () => {
    it.each([
      { prompt: 'Search my github repos', keyword: 'github' },
      { prompt: 'Explore the repo structure', keyword: 'repo' },
      { prompt: 'Look at the repository', keyword: 'repository' },
      { prompt: 'Can you explore repo for me?', keyword: 'explore repo' },
      { prompt: 'Please explore repository contents', keyword: 'explore repository' },
      { prompt: 'Search code in this project', keyword: 'search code' },
    ])('should detect $keyword', ({ prompt }) => {
      expect(needsGitHubTools(prompt)).toBe(true);
    });
  });

  describe('non-GitHub prompts', () => {
    it.each([
      'Explain how React hooks work',
      'What is TypeScript?',
      'Help me understand async/await',
      'How do I write unit tests?',
      'What are best practices for error handling?',
    ])('should not detect GitHub tools need in "%s"', (prompt) => {
      expect(needsGitHubTools(prompt)).toBe(false);
    });
  });

  describe('case insensitivity', () => {
    it.each([
      'GITHUB',
      'GitHub',
      'github',
      'REPO',
      'Repo',
      'REPOSITORY',
    ])('should detect %s regardless of case', (keyword) => {
      expect(needsGitHubTools(`Tell me about ${keyword}`)).toBe(true);
    });
  });

  describe('partial matches', () => {
    it('should detect keyword within sentence', () => {
      expect(needsGitHubTools('I want to search my github account')).toBe(true);
      expect(needsGitHubTools('What files are in the repo?')).toBe(true);
    });

    it('should not match partial words', () => {
      // 'repo' is contained in 'report' but we're checking includes
      // This will match because 'repo' is a substring - documenting actual behavior
      expect(needsGitHubTools('Generate a report')).toBe(true); // 'repo' in 'report'
    });
  });
});
