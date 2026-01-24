/**
 * Challenge Evaluation Module Tests
 *
 * Tests for evaluation prompt building and response parsing.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEvaluationPrompt,
  parseEvaluationResponse,
  parsePartialEvaluation,
  extractStreamingFeedback,
  type WorkspaceFileInput,
} from './evaluation';
import type { ChallengeDef } from './types';

// =============================================================================
// Test Fixtures
// =============================================================================

const mockChallenge: ChallengeDef = {
  title: 'Sum Array',
  description: 'Write a function that sums all numbers in an array.',
  language: 'TypeScript',
  difficulty: 'beginner',
  expectedPatterns: ['reduce', 'accumulator'],
  testCases: [
    { input: '[1, 2, 3]', expectedOutput: '6' },
    { input: '[]', expectedOutput: '0', description: 'empty array' },
  ],
};

const mockFiles: WorkspaceFileInput[] = [
  { name: 'solution.ts', content: 'export const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);' },
];

// =============================================================================
// buildEvaluationPrompt Tests
// =============================================================================

describe('buildEvaluationPrompt', () => {
  it('should include challenge title and difficulty', () => {
    const prompt = buildEvaluationPrompt(mockChallenge, mockFiles);

    expect(prompt).toContain('## Challenge: Sum Array');
    expect(prompt).toContain('**Difficulty**: beginner');
  });

  it('should include challenge description', () => {
    const prompt = buildEvaluationPrompt(mockChallenge, mockFiles);
    expect(prompt).toContain('Write a function that sums all numbers in an array.');
  });

  it('should include expected patterns when provided', () => {
    const prompt = buildEvaluationPrompt(mockChallenge, mockFiles);
    expect(prompt).toContain('### Expected Patterns');
    expect(prompt).toContain('reduce, accumulator');
  });

  it('should include test cases when provided', () => {
    const prompt = buildEvaluationPrompt(mockChallenge, mockFiles);
    expect(prompt).toContain('### Test Cases');
    expect(prompt).toContain('[1, 2, 3]');
    expect(prompt).toContain('6');
    expect(prompt).toContain('empty array');
  });

  it('should include file content with correct formatting', () => {
    const prompt = buildEvaluationPrompt(mockChallenge, mockFiles);
    expect(prompt).toContain('### solution.ts');
    expect(prompt).toContain('```ts');
    expect(prompt).toContain('arr.reduce((a, b) => a + b, 0)');
  });

  it('should handle multiple files', () => {
    const multipleFiles: WorkspaceFileInput[] = [
      { name: 'solution.ts', content: 'export const sum = () => 0;' },
      { name: 'utils.ts', content: 'export const helper = () => {};' },
    ];

    const prompt = buildEvaluationPrompt(mockChallenge, multipleFiles);
    expect(prompt).toContain('(2 files)');
    expect(prompt).toContain('### solution.ts');
    expect(prompt).toContain('### utils.ts');
  });

  it('should handle challenge without expected patterns', () => {
    const challengeNoPatterns: ChallengeDef = {
      ...mockChallenge,
      expectedPatterns: undefined,
    };

    const prompt = buildEvaluationPrompt(challengeNoPatterns, mockFiles);
    expect(prompt).not.toContain('### Expected Patterns');
  });

  it('should handle challenge without test cases', () => {
    const challengeNoTests: ChallengeDef = {
      ...mockChallenge,
      testCases: undefined,
    };

    const prompt = buildEvaluationPrompt(challengeNoTests, mockFiles);
    expect(prompt).not.toContain('### Test Cases');
  });
});

// =============================================================================
// parseEvaluationResponse Tests
// =============================================================================

describe('parseEvaluationResponse', () => {
  it('should parse a complete evaluation response', () => {
    const response = `\`\`\`json
{
  "isCorrect": true,
  "score": 120,
  "strengths": ["Clean implementation", "Good use of reduce"],
  "improvements": ["Could add type guard"],
  "nextSteps": ["Try with other array methods"]
}
\`\`\`

---FEEDBACK---
Excellent work! Your solution is correct and well-structured.
---END FEEDBACK---`;

    const result = parseEvaluationResponse(response);

    expect(result).not.toBeNull();
    expect(result?.isCorrect).toBe(true);
    expect(result?.score).toBe(120);
    expect(result?.strengths).toEqual(['Clean implementation', 'Good use of reduce']);
    expect(result?.improvements).toEqual(['Could add type guard']);
    expect(result?.nextSteps).toEqual(['Try with other array methods']);
    expect(result?.feedback).toBe('Excellent work! Your solution is correct and well-structured.');
  });

  it('should parse response without feedback markers', () => {
    const response = `{
  "isCorrect": false,
  "score": 50,
  "feedback": "Missing edge case handling",
  "strengths": ["Good attempt"],
  "improvements": ["Handle empty arrays"]
}`;

    const result = parseEvaluationResponse(response);

    expect(result?.isCorrect).toBe(false);
    expect(result?.score).toBe(50);
    expect(result?.feedback).toBe('Missing edge case handling');
  });

  it('should return null for invalid JSON', () => {
    const response = 'This is not valid JSON at all';
    const result = parseEvaluationResponse(response);
    expect(result).toBeNull();
  });

  it('should provide defaults for missing fields', () => {
    const response = '{"isCorrect": true}';
    const result = parseEvaluationResponse(response);

    expect(result?.isCorrect).toBe(true);
    expect(result?.strengths).toEqual([]);
    expect(result?.improvements).toEqual([]);
    expect(result?.feedback).toBe('Unable to provide detailed feedback.');
  });

  it('should default isCorrect to false when missing', () => {
    const response = '{"score": 75}';
    const result = parseEvaluationResponse(response);
    expect(result?.isCorrect).toBe(false);
  });
});

// =============================================================================
// parsePartialEvaluation Tests
// =============================================================================

describe('parsePartialEvaluation', () => {
  it('should extract metadata from complete JSON', () => {
    const streaming = `\`\`\`json
{
  "isCorrect": true,
  "score": 100,
  "strengths": ["Good"],
  "improvements": [],
  "nextSteps": ["Continue"]
}
\`\`\``;

    const result = parsePartialEvaluation(streaming);

    expect(result).not.toBeNull();
    expect(result?.isCorrect).toBe(true);
    expect(result?.score).toBe(100);
  });

  it('should return null for incomplete JSON', () => {
    const streaming = '{"isCorrect": tr';
    const result = parsePartialEvaluation(streaming);
    expect(result).toBeNull();
  });

  it('should return null when isCorrect is missing', () => {
    const streaming = '{"score": 100}';
    const result = parsePartialEvaluation(streaming);
    expect(result).toBeNull();
  });

  it('should provide defaults for missing arrays', () => {
    const streaming = '{"isCorrect": false, "score": 40}';
    const result = parsePartialEvaluation(streaming);

    expect(result?.strengths).toEqual([]);
    expect(result?.improvements).toEqual([]);
  });
});

// =============================================================================
// extractStreamingFeedback Tests
// =============================================================================

describe('extractStreamingFeedback', () => {
  it('should extract feedback between markers', () => {
    const content = `Some JSON here
---FEEDBACK---
This is the feedback text.
---END FEEDBACK---`;

    const result = extractStreamingFeedback(content);
    expect(result).toBe('This is the feedback text.');
  });

  it('should return partial feedback while streaming', () => {
    const content = `{"isCorrect": true}
---FEEDBACK---
Partial feedback so far`;

    const result = extractStreamingFeedback(content);
    expect(result).toBe('Partial feedback so far');
  });

  it('should return empty string before feedback marker', () => {
    const content = '{"isCorrect": true, "score": 100}';
    const result = extractStreamingFeedback(content);
    expect(result).toBe('');
  });

  it('should handle multiline feedback', () => {
    const content = `---FEEDBACK---
Line 1
Line 2
Line 3
---END FEEDBACK---`;

    const result = extractStreamingFeedback(content);
    expect(result).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should trim whitespace from extracted feedback', () => {
    const content = `---FEEDBACK---
   Feedback with whitespace   
---END FEEDBACK---`;

    const result = extractStreamingFeedback(content);
    expect(result).toBe('Feedback with whitespace');
  });
});
