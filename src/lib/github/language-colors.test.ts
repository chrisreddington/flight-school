/**
 * GitHub Language Colors Tests
 *
 * Tests for language color lookup utility.
 */

import { describe, expect, it } from 'vitest';
import { getLanguageColor } from './language-colors';

describe('getLanguageColor', () => {
  describe('known languages', () => {
    it.each([
      { language: 'TypeScript', expected: '#3178c6' },
      { language: 'JavaScript', expected: '#f1e05a' },
      { language: 'Python', expected: '#3572A5' },
      { language: 'Go', expected: '#00ADD8' },
      { language: 'Rust', expected: '#dea584' },
      { language: 'Java', expected: '#b07219' },
      { language: 'C#', expected: '#178600' },
      { language: 'C++', expected: '#f34b7d' },
      { language: 'C', expected: '#555555' },
      { language: 'Ruby', expected: '#701516' },
      { language: 'PHP', expected: '#4F5D95' },
      { language: 'Swift', expected: '#F05138' },
      { language: 'Kotlin', expected: '#A97BFF' },
      { language: 'Shell', expected: '#89e051' },
      { language: 'HTML', expected: '#e34c26' },
      { language: 'CSS', expected: '#563d7c' },
      { language: 'SCSS', expected: '#c6538c' },
      { language: 'Vue', expected: '#41b883' },
      { language: 'Dockerfile', expected: '#384d54' },
      { language: 'Markdown', expected: '#083fa1' },
      { language: 'HCL', expected: '#844FBA' },
      { language: 'Bicep', expected: '#519aba' },
    ])(
      'should return $expected for $language',
      ({ language, expected }) => {
        expect(getLanguageColor(language)).toBe(expected);
      }
    );
  });

  describe('unknown languages', () => {
    it.each([
      'UnknownLanguage',
      'COBOL',
      'Fortran',
      'Erlang',
      '',
      'typescript', // Case-sensitive check
      'TYPESCRIPT',
    ])(
      'should return default color for "%s"',
      (language) => {
        expect(getLanguageColor(language)).toBe('#6e7681');
      }
    );
  });

  describe('edge cases', () => {
    it('should be case-sensitive', () => {
      expect(getLanguageColor('TypeScript')).toBe('#3178c6');
      expect(getLanguageColor('typescript')).toBe('#6e7681');
      expect(getLanguageColor('TYPESCRIPT')).toBe('#6e7681');
    });

    it('should handle special characters in language names', () => {
      expect(getLanguageColor('C#')).toBe('#178600');
      expect(getLanguageColor('C++')).toBe('#f34b7d');
    });
  });
});
