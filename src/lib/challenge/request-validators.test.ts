/**
 * Tests for challenge request validators
 */

import { describe, it, expect } from 'vitest';
import {
  validateHintRequest,
  validateSolveRequest,
  validateEvaluateRequest,
} from './request-validators';

// =============================================================================
// Test Fixtures
// =============================================================================

const validChallenge = {
  title: 'Test Challenge',
  description: 'A test challenge description',
  language: 'typescript',
  difficulty: 'intermediate',
};

const validFiles = [
  { name: 'solution.ts', content: 'const x = 1;' },
  { name: 'test.ts', content: 'expect(x).toBe(1);' },
];

// =============================================================================
// validateHintRequest Tests
// =============================================================================

describe('validateHintRequest', () => {
  it('should return null for valid hint request', () => {
    const body = {
      challenge: validChallenge,
      question: 'How do I solve this?',
      currentCode: 'const x = 1;',
    };
    expect(validateHintRequest(body)).toBeNull();
  });

  describe('body validation', () => {
    it.each([
      [null, 'Request body is required'],
      [undefined, 'Request body is required'],
      ['string', 'Request body is required'],
      [123, 'Request body is required'],
    ])('should reject %p with "%s"', (body, expected) => {
      expect(validateHintRequest(body)).toBe(expected);
    });

    it('should treat empty array as object (validates challenge)', () => {
      // Arrays are objects in JS, so the validator will check for challenge
      expect(validateHintRequest([])).toBe('challenge is required and must be an object');
    });
  });

  describe('challenge validation', () => {
    it.each([
      [{ challenge: null }, 'challenge is required and must be an object'],
      [{ challenge: 'string' }, 'challenge is required and must be an object'],
      [{ challenge: {} }, 'challenge.title is required'],
      [{ challenge: { title: 123 } }, 'challenge.title is required'],
      [{ challenge: { title: 'Test' } }, 'challenge.description is required'],
      [{ challenge: { title: 'Test', description: 'Desc' } }, 'challenge.language is required'],
      [{ challenge: { title: 'Test', description: 'Desc', language: 'ts' } }, 'challenge.difficulty is required'],
      [
        { challenge: { ...validChallenge, difficulty: 'expert' } },
        'challenge.difficulty must be one of: beginner, intermediate, advanced',
      ],
    ])('should validate challenge object for %p', (body, expected) => {
      expect(validateHintRequest(body)).toBe(expected);
    });
  });

  describe('question validation', () => {
    it('should require question field', () => {
      const body = { challenge: validChallenge };
      expect(validateHintRequest(body)).toBe('question is required');
    });

    it('should reject non-string question', () => {
      const body = { challenge: validChallenge, question: 123 };
      expect(validateHintRequest(body)).toBe('question is required');
    });

    it('should reject question exceeding max length', () => {
      const body = {
        challenge: validChallenge,
        question: 'x'.repeat(1001),
        currentCode: '',
      };
      expect(validateHintRequest(body)).toBe('question exceeds maximum length (1000 characters)');
    });
  });

  describe('currentCode validation', () => {
    it('should require currentCode as string', () => {
      const body = {
        challenge: validChallenge,
        question: 'Help?',
        currentCode: 123,
      };
      expect(validateHintRequest(body)).toBe('currentCode must be a string');
    });

    it('should reject currentCode exceeding max length', () => {
      const body = {
        challenge: validChallenge,
        question: 'Help?',
        currentCode: 'x'.repeat(50001),
      };
      expect(validateHintRequest(body)).toBe('currentCode exceeds maximum length (50000 characters)');
    });

    it('should accept empty currentCode', () => {
      const body = {
        challenge: validChallenge,
        question: 'Help?',
        currentCode: '',
      };
      expect(validateHintRequest(body)).toBeNull();
    });
  });
});

// =============================================================================
// validateSolveRequest Tests
// =============================================================================

describe('validateSolveRequest', () => {
  it('should return null for valid solve request', () => {
    const body = {
      challenge: validChallenge,
      files: validFiles,
    };
    expect(validateSolveRequest(body)).toBeNull();
  });

  describe('body validation', () => {
    it.each([
      [null, 'Request body is required'],
      [undefined, 'Request body is required'],
    ])('should reject %p with "%s"', (body, expected) => {
      expect(validateSolveRequest(body)).toBe(expected);
    });
  });

  describe('files validation', () => {
    it('should require files array', () => {
      const body = { challenge: validChallenge };
      expect(validateSolveRequest(body)).toBe('files is required and must be an array');
    });

    it('should reject non-array files', () => {
      const body = { challenge: validChallenge, files: 'not-array' };
      expect(validateSolveRequest(body)).toBe('files is required and must be an array');
    });

    it('should reject invalid file objects', () => {
      const body = { challenge: validChallenge, files: [null] };
      expect(validateSolveRequest(body)).toBe('Invalid file format');
    });

    it('should require file name', () => {
      const body = { challenge: validChallenge, files: [{ content: 'code' }] };
      expect(validateSolveRequest(body)).toBe('Each file must have a name');
    });

    it('should require file content', () => {
      const body = { challenge: validChallenge, files: [{ name: 'test.ts' }] };
      expect(validateSolveRequest(body)).toBe('Each file must have content');
    });

    it('should accept empty files array', () => {
      const body = { challenge: validChallenge, files: [] };
      expect(validateSolveRequest(body)).toBeNull();
    });
  });
});

// =============================================================================
// validateEvaluateRequest Tests
// =============================================================================

describe('validateEvaluateRequest', () => {
  it('should return null for valid evaluate request', () => {
    const body = {
      challenge: validChallenge,
      files: validFiles,
    };
    expect(validateEvaluateRequest(body)).toBeNull();
  });

  describe('body validation', () => {
    it.each([
      [null, 'Request body is required'],
      [undefined, 'Request body is required'],
    ])('should reject %p with "%s"', (body, expected) => {
      expect(validateEvaluateRequest(body)).toBe(expected);
    });
  });

  describe('file size validation', () => {
    it('should reject files exceeding total size limit', () => {
      const largeContent = 'x'.repeat(100001);
      const body = {
        challenge: validChallenge,
        files: [{ name: 'large.ts', content: largeContent }],
      };
      expect(validateEvaluateRequest(body)).toBe(
        'Total file content exceeds maximum size (100000 characters)'
      );
    });

    it('should accept files within size limit', () => {
      const body = {
        challenge: validChallenge,
        files: [{ name: 'solution.ts', content: 'x'.repeat(99999) }],
      };
      expect(validateEvaluateRequest(body)).toBeNull();
    });
  });

  describe('difficulty levels', () => {
    it.each(['beginner', 'intermediate', 'advanced'] as const)(
      'should accept difficulty level "%s"',
      (difficulty) => {
        const body = {
          challenge: { ...validChallenge, difficulty },
          files: validFiles,
        };
        expect(validateEvaluateRequest(body)).toBeNull();
      }
    );
  });
});
