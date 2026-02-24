/**
 * Tests for Workspace Templates.
 *
 * Tests template generation functions for different programming languages.
 * These are pure functions with no side effects.
 */

import { describe, it, expect } from 'vitest';
import type { ChallengeDef } from '@/lib/copilot/types';
import { getWorkspaceTemplate, createEmptyFile } from './templates';

describe('Workspace Templates', () => {
  const baseChallenge: ChallengeDef = {
    title: 'Reverse String',
    description: 'Write a function that reverses a string',
    difficulty: 'beginner',
    language: 'TypeScript',
  };

  // ===========================================================================
  // getWorkspaceTemplate() - TypeScript
  // ===========================================================================

  describe('getWorkspaceTemplate - TypeScript', () => {
    it('should generate TypeScript solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.ts');
      expect(files[0].language).toBe('typescript');
      expect(files[0].content).toContain('// Reverse String');
      expect(files[0].content).toContain('export function solution()');
    });

    it('should include test file when description mentions testing', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'TypeScript',
        description: 'Write a function with unit tests that reverses a string',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[0].name).toBe('solution.ts');
      expect(files[1].name).toBe('solution.test.ts');
      expect(files[1].content).toContain("import { describe, it, expect } from 'vitest'");
    });

    it('should include test file when description mentions TDD', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'TypeScript',
        description: 'Practice test-driven development by building a solution',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solution.test.ts');
    });

    it('should use broken code as starter for debug challenges', () => {
      const files = getWorkspaceTemplate({
        ...baseChallenge,
        type: 'debug',
        brokenCode: 'export function solution() { return "broken"; }',
      });

      expect(files).toHaveLength(1);
      expect(files[0].content).toBe('export function solution() { return "broken"; }');
    });

    it('should set timestamps on files', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });

      expect(files[0].createdAt).toBeDefined();
      expect(files[0].updatedAt).toBeDefined();
      expect(files[0].createdAt).toBe(files[0].updatedAt);
    });

    it('should generate unique file IDs', () => {
      const files1 = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });
      const files2 = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });

      expect(files1[0].id).not.toBe(files2[0].id);
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - JavaScript
  // ===========================================================================

  describe('getWorkspaceTemplate - JavaScript', () => {
    it('should generate JavaScript solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'JavaScript' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.js');
      expect(files[0].language).toBe('javascript');
      expect(files[0].content).toContain('export function solution()');
    });

    it('should include JavaScript test file when needed', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'JavaScript',
        description: 'Write tests for your solution',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solution.test.js');
      expect(files[1].content).toContain("import { describe, it, expect } from 'vitest'");
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Python
  // ===========================================================================

  describe('getWorkspaceTemplate - Python', () => {
    it('should generate Python solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Python' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.py');
      expect(files[0].language).toBe('python');
      expect(files[0].content).toContain('def solution():');
      expect(files[0].content).toContain('# Reverse String');
    });

    it('should include Python test file with unittest', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'Python',
        description: 'Write test cases for the solution',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solution_test.py');
      expect(files[1].content).toContain('import unittest');
      expect(files[1].content).toContain('class TestSolution');
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Java
  // ===========================================================================

  describe('getWorkspaceTemplate - Java', () => {
    it('should generate Java solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Java' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.java');
      expect(files[0].language).toBe('java');
      expect(files[0].content).toContain('public class Solution');
      expect(files[0].content).toContain('public static void main');
    });

    it('should include Java test file with JUnit', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'Java',
        description: 'Write unit tests',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solutionTest.java');
      expect(files[1].content).toContain('import org.junit.jupiter.api.Test');
      expect(files[1].content).toContain('class SolutionTest');
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Go
  // ===========================================================================

  describe('getWorkspaceTemplate - Go', () => {
    it('should generate Go solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Go' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.go');
      expect(files[0].language).toBe('go');
      expect(files[0].content).toContain('package main');
      expect(files[0].content).toContain('func solution()');
    });

    it('should include Go test file', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'Go',
        description: 'Write tests for your code',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solution_test.go');
      expect(files[1].content).toContain('import "testing"');
      expect(files[1].content).toContain('func TestSolution');
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Rust
  // ===========================================================================

  describe('getWorkspaceTemplate - Rust', () => {
    it('should generate Rust solution file', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Rust' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.rs');
      expect(files[0].language).toBe('rust');
      expect(files[0].content).toContain('fn solution()');
    });

    it('should include Rust test file', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'Rust',
        description: 'Test-driven challenge',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
      expect(files[1].name).toBe('solution_test.rs');
      expect(files[1].content).toContain('#[cfg(test)]');
      expect(files[1].content).toContain('#[test]');
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - C#
  // ===========================================================================

  describe('getWorkspaceTemplate - C#', () => {
    it.each([
      ['C#', 'c#'],
      ['CSharp', 'csharp'],
      ['csharp', 'csharp'],
    ])('should handle %s as language name', (languageName, expectedNormalized) => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: languageName });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.cs');
      expect(files[0].language).toBe(expectedNormalized);
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Case insensitivity
  // ===========================================================================

  describe('getWorkspaceTemplate - case insensitivity', () => {
    it.each([
      ['typescript', 'solution.ts'],
      ['TypeScript', 'solution.ts'],
      ['TYPESCRIPT', 'solution.ts'],
      ['python', 'solution.py'],
      ['Python', 'solution.py'],
      ['go', 'solution.go'],
      ['Go', 'solution.go'],
      ['GO', 'solution.go'],
    ])('should handle %s and create %s', (language, expectedFilename) => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language });

      expect(files[0].name).toBe(expectedFilename);
      expect(files[0].language).toBe(language.toLowerCase());
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Unknown languages
  // ===========================================================================

  describe('getWorkspaceTemplate - unknown languages', () => {
    it('should fallback to .txt for unknown language', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Brainfuck' });

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.txt');
      expect(files[0].language).toBe('brainfuck');
    });

    it('should include title and description in fallback template', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'Unknown' });

      expect(files[0].content).toContain('// Reverse String');
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - TDD detection
  // ===========================================================================

  describe('getWorkspaceTemplate - TDD keyword detection', () => {
    it.each([
      ['includes "test"', 'Write a test for this function'],
      ['includes "TDD"', 'Use TDD approach'],
      ['includes "test-driven"', 'Use test-driven development'],
      ['includes "unit test"', 'Create unit test suite'],
      ['includes "testing"', 'Focus on testing'],
      ['includes "write tests"', 'You should write tests'],
      ['includes "test case"', 'Add test case for edge cases'],
    ])('should add test file when description %s', (_, description) => {
      const tddChallenge = { ...baseChallenge, language: 'TypeScript', description };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files.length).toBeGreaterThan(1);
      expect(files.some((f) => f.name.includes('test'))).toBe(true);
    });

    it('should not add test file when description has no TDD keywords', () => {
      const regularChallenge = {
        ...baseChallenge,
        language: 'TypeScript',
        description: 'Build a simple calculator',
      };

      const files = getWorkspaceTemplate(regularChallenge);

      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('solution.ts');
    });

    it('should be case-insensitive for TDD keyword detection', () => {
      const tddChallenge = {
        ...baseChallenge,
        language: 'TypeScript',
        description: 'Build with UNIT TESTS',
      };

      const files = getWorkspaceTemplate(tddChallenge);

      expect(files).toHaveLength(2);
    });
  });

  // ===========================================================================
  // getWorkspaceTemplate() - Multi-line descriptions
  // ===========================================================================

  describe('getWorkspaceTemplate - multi-line descriptions', () => {
    it('should include only first line in starter code comment', () => {
      const multiLineChallenge = {
        ...baseChallenge,
        language: 'TypeScript',
        description: 'First line of description\nSecond line with more details\nThird line',
      };

      const files = getWorkspaceTemplate(multiLineChallenge);

      expect(files[0].content).toContain('// First line of description');
      expect(files[0].content).not.toContain('Second line');
    });
  });

  // ===========================================================================
  // createEmptyFile() tests
  // ===========================================================================

  describe('createEmptyFile', () => {
    it('should create empty file with given name and language', () => {
      const file = createEmptyFile('utils.ts', 'TypeScript');

      expect(file.name).toBe('utils.ts');
      expect(file.language).toBe('typescript');
      expect(file.content).toBe('');
      expect(file.id).toBeDefined();
      expect(file.createdAt).toBeDefined();
      expect(file.updatedAt).toBeDefined();
    });

    it('should normalize language to lowercase', () => {
      const file = createEmptyFile('test.py', 'PYTHON');

      expect(file.language).toBe('python');
    });

    it('should generate unique IDs', () => {
      const file1 = createEmptyFile('a.ts', 'TypeScript');
      const file2 = createEmptyFile('b.ts', 'TypeScript');

      expect(file1.id).not.toBe(file2.id);
    });

    it('should set createdAt and updatedAt to same value', () => {
      const file = createEmptyFile('new.js', 'JavaScript');

      expect(file.createdAt).toBe(file.updatedAt);
    });
  });

  // ===========================================================================
  // Template content validation
  // ===========================================================================

  describe('template content validation', () => {
    it('should include challenge title in all templates', () => {
      const languages = ['TypeScript', 'JavaScript', 'Python', 'Java', 'Go', 'Rust'];

      languages.forEach((language) => {
        const files = getWorkspaceTemplate({ ...baseChallenge, language });
        expect(files[0].content).toContain(baseChallenge.title);
      });
    });

    it('should include comment marker appropriate to language', () => {
      const testCases = [
        { language: 'TypeScript', marker: '//' },
        { language: 'JavaScript', marker: '//' },
        { language: 'Python', marker: '#' },
        { language: 'Java', marker: '//' },
        { language: 'Go', marker: '//' },
        { language: 'Rust', marker: '//' },
      ];

      testCases.forEach(({ language, marker }) => {
        const files = getWorkspaceTemplate({ ...baseChallenge, language });
        expect(files[0].content).toContain(`${marker} ${baseChallenge.title}`);
      });
    });

    it('should not have trailing whitespace in generated code', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });
      const lines = files[0].content.split('\n');

      lines.forEach((line, index) => {
        if (line.trim() !== '') {
          expect(line).not.toMatch(/\s+$/);
        }
      });
    });

    it('should end with newline', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, language: 'TypeScript' });

      expect(files[0].content).toMatch(/\n$/);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty title', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, title: '', language: 'TypeScript' });

      expect(files).toHaveLength(1);
      expect(files[0].content).toBeDefined();
    });

    it('should handle empty description', () => {
      const files = getWorkspaceTemplate({ ...baseChallenge, description: '', language: 'TypeScript' });

      expect(files).toHaveLength(1);
      expect(files[0].content).toBeDefined();
    });

    it('should handle special characters in title', () => {
      const specialChallenge = {
        ...baseChallenge,
        title: 'Reverse "String" & <Escape>',
        language: 'TypeScript',
      };

      const files = getWorkspaceTemplate(specialChallenge);

      expect(files[0].content).toContain('Reverse "String" & <Escape>');
    });
  });
});
