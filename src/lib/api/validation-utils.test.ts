/**
 * Tests for API validation utilities.
 *
 * Covers all branches of validateObject and validateRequiredString.
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  describe('invalid inputs — returns error message', () => {
    it.each([
      { value: null, desc: 'null' },
      { value: undefined, desc: 'undefined' },
      { value: 0, desc: 'zero' },
      { value: 42, desc: 'number' },
      { value: '', desc: 'empty string' },
      { value: 'hello', desc: 'non-empty string' },
      { value: true, desc: 'boolean true' },
      { value: false, desc: 'boolean false' },
    ])('should return error for $desc', ({ value }) => {
      const result = validateObject(value, 'body');
      expect(result).toBe('body is required and must be an object');
    });
  });

  describe('valid inputs — returns null', () => {
    it.each([
      { value: {}, desc: 'empty object' },
      { value: { a: 1 }, desc: 'plain object' },
      { value: [], desc: 'array (is an object)' },
      { value: [1, 2, 3], desc: 'array with items' },
    ])('should return null for $desc', ({ value }) => {
      expect(validateObject(value, 'body')).toBeNull();
    });
  });

  it('should include fieldName in the error message', () => {
    const result = validateObject(null, 'requestPayload');
    expect(result).toContain('requestPayload');
  });
});

describe('validateRequiredString', () => {
  describe('invalid inputs — returns error message', () => {
    it.each([
      { value: null, desc: 'null' },
      { value: undefined, desc: 'undefined' },
      { value: 0, desc: 'number zero' },
      { value: false, desc: 'boolean false' },
      { value: {}, desc: 'object' },
      { value: '', desc: 'empty string' },
      { value: '   ', desc: 'whitespace-only string' },
      { value: '\t\n', desc: 'tab/newline whitespace' },
    ])('should return error for $desc', ({ value }) => {
      const result = validateRequiredString(value as unknown as string, 'title');
      expect(result).toBe('title is required');
    });
  });

  describe('valid inputs — returns null', () => {
    it.each([
      { value: 'hello', desc: 'non-empty string' },
      { value: ' hello ', desc: 'string with surrounding whitespace (has content)' },
      { value: 'a', desc: 'single character' },
      { value: '0', desc: 'string zero' },
    ])('should return null for $desc', ({ value }) => {
      expect(validateRequiredString(value, 'title')).toBeNull();
    });
  });

  it('should include fieldName in the error message', () => {
    const result = validateRequiredString('', 'userName');
    expect(result).toBe('userName is required');
  });
});
