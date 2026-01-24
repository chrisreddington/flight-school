/**
 * Tests for JSON extraction utilities.
 *
 * Covers all 5 extraction strategies and edge cases.
 */

import { describe, it, expect, vi } from 'vitest';
import { extractJSON } from './json-utils';

// Mock the logger to avoid console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({
      debug: vi.fn(),
      warn: vi.fn(),
    }),
  },
}));

describe('extractJSON', () => {
  describe('Strategy 1: JSON code blocks (```json)', () => {
    it.each([
      {
        input: '```json\n{"key": "value"}\n```',
        expected: { key: 'value' },
        desc: 'simple object',
      },
      {
        input: 'Some text before\n```json\n{"nested": {"a": 1}}\n```\nText after',
        expected: { nested: { a: 1 } },
        desc: 'with surrounding text',
      },
      {
        input: '```json\n[1, 2, 3]\n```',
        expected: [1, 2, 3],
        desc: 'array',
      },
      {
        input: '```json\n  {"spaced": true}  \n```',
        expected: { spaced: true },
        desc: 'with whitespace',
      },
    ])('should extract $desc from ```json block', ({ input, expected }) => {
      expect(extractJSON(input)).toEqual(expected);
    });
  });

  describe('Strategy 2: Generic code blocks (```)', () => {
    it.each([
      {
        input: '```\n{"key": "value"}\n```',
        expected: { key: 'value' },
        desc: 'object without language tag',
      },
      {
        input: '```\n["a", "b"]\n```',
        expected: ['a', 'b'],
        desc: 'array without language tag',
      },
    ])('should extract $desc from ``` block', ({ input, expected }) => {
      expect(extractJSON(input)).toEqual(expected);
    });

    it('should skip non-JSON code blocks', () => {
      const input = '```\nconst x = 1;\n```\n{"fallback": true}';
      expect(extractJSON(input)).toEqual({ fallback: true });
    });
  });

  describe('Strategy 3: Brace counting (nested objects)', () => {
    it.each([
      {
        input: 'Here is the data: {"outer": {"inner": {"deep": 1}}}',
        expected: { outer: { inner: { deep: 1 } } },
        desc: 'deeply nested object',
      },
      {
        input: 'Result: {"a": 1, "b": {"c": 2}} and more text',
        expected: { a: 1, b: { c: 2 } },
        desc: 'object with trailing text',
      },
      {
        input: '{"key": "value with {braces} inside"}',
        expected: { key: 'value with {braces} inside' },
        desc: 'braces in string values',
      },
    ])('should extract $desc using brace counting', ({ input, expected }) => {
      expect(extractJSON(input)).toEqual(expected);
    });
  });

  describe('Strategy 4: Bracket counting (arrays)', () => {
    it('should extract nested array using bracket counting', () => {
      const input = 'Array result: [1, [2, 3], 4]';
      expect(extractJSON(input)).toEqual([1, [2, 3], 4]);
    });

    it('should prefer brace counting (Strategy 3) over bracket counting for arrays with objects', () => {
      // When input contains both { and [, Strategy 3 (brace counting) runs first
      // and extracts the first object {"a": 1} before Strategy 4 can extract the array
      const input = 'Items: [{"a": 1}, {"b": 2}] done';
      // Strategy 3 finds the first { and extracts {"a": 1}
      expect(extractJSON(input)).toEqual({ a: 1 });
    });

    it('should extract simple array when no braces present', () => {
      const input = 'Numbers: [1, 2, 3] here';
      expect(extractJSON(input)).toEqual([1, 2, 3]);
    });
  });

  describe('Strategy 5: Direct parse', () => {
    it.each([
      {
        input: '{"direct": "json"}',
        expected: { direct: 'json' },
        desc: 'object',
      },
      {
        input: '[1, 2, 3]',
        expected: [1, 2, 3],
        desc: 'array',
      },
      {
        input: '"string"',
        expected: 'string',
        desc: 'string',
      },
      {
        input: '123',
        expected: 123,
        desc: 'number',
      },
      {
        input: 'true',
        expected: true,
        desc: 'boolean',
      },
      {
        input: 'null',
        expected: null,
        desc: 'null',
      },
    ])('should directly parse valid JSON $desc', ({ input, expected }) => {
      expect(extractJSON(input)).toEqual(expected);
    });
  });

  describe('Edge cases', () => {
    it.each([
      { input: '', desc: 'empty string' },
      { input: null as unknown as string, desc: 'null' },
      { input: undefined as unknown as string, desc: 'undefined' },
    ])('should return null for $desc', ({ input }) => {
      expect(extractJSON(input)).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      expect(extractJSON('not json at all')).toBeNull();
      expect(extractJSON('{broken: json}')).toBeNull();
      expect(extractJSON('{"unclosed": ')).toBeNull();
    });

    it('should handle context parameter for logging', () => {
      const result = extractJSON('{"valid": true}', 'TestContext');
      expect(result).toEqual({ valid: true });
    });

    it('should prefer earlier strategies over later ones', () => {
      // JSON code block should take precedence over raw JSON
      const input = '```json\n{"from": "codeblock"}\n```\n{"from": "raw"}';
      expect(extractJSON(input)).toEqual({ from: 'codeblock' });
    });
  });

  describe('Real-world AI response patterns', () => {
    it('should extract from ChatGPT-style response', () => {
      const response = `Here's the analysis:

\`\`\`json
{
  "skills": ["TypeScript", "React"],
  "level": "intermediate"
}
\`\`\`

Let me know if you need more details.`;

      expect(extractJSON(response)).toEqual({
        skills: ['TypeScript', 'React'],
        level: 'intermediate',
      });
    });

    it('should extract from response with multiple code blocks', () => {
      const response = `First, let's look at this:
\`\`\`javascript
const x = 1;
\`\`\`

Now the JSON:
\`\`\`json
{"result": "success"}
\`\`\``;

      expect(extractJSON(response)).toEqual({ result: 'success' });
    });
  });
});
