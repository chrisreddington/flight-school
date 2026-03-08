/**
 * Tests for API validation utilities.
 *
 * Covers all validation rules and boundary conditions.
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  describe('valid inputs', () => {
    it.each([
      { input: {}, desc: 'empty object' },
      { input: { key: 'value' }, desc: 'simple object' },
      { input: { nested: { a: 1 } }, desc: 'nested object' },
      { input: [], desc: 'array (typeof array === object)' },
    ])('should return null for $desc', ({ input }) => {
      expect(validateObject(input, 'field')).toBeNull();
    });
  });

  describe('invalid inputs', () => {
    it.each([
      { input: null, desc: 'null' },
      { input: undefined, desc: 'undefined' },
      { input: 0, desc: 'zero (falsy number)' },
      { input: '', desc: 'empty string' },
      { input: false, desc: 'false' },
      { input: 42, desc: 'number' },
      { input: 'string', desc: 'string' },
      { input: true, desc: 'boolean true' },
    ])('should return error message for $desc', ({ input }) => {
      const result = validateObject(input, 'Request body');
      expect(result).toBe('Request body is required and must be an object');
    });
  });

  it('should include fieldName in error message', () => {
    expect(validateObject(null, 'My Field')).toBe(
      'My Field is required and must be an object'
    );
    expect(validateObject(null, 'payload')).toBe(
      'payload is required and must be an object'
    );
  });
});

describe('validateRequiredString', () => {
  describe('valid inputs', () => {
    it.each([
      { input: 'hello', desc: 'simple string' },
      { input: 'a', desc: 'single character' },
      { input: '  hello  ', desc: 'string with surrounding spaces' },
      { input: 'hello world', desc: 'string with spaces in middle' },
      { input: '123', desc: 'numeric string' },
    ])('should return null for $desc', ({ input }) => {
      expect(validateRequiredString(input, 'field')).toBeNull();
    });
  });

  describe('invalid inputs', () => {
    it.each([
      { input: null, desc: 'null' },
      { input: undefined, desc: 'undefined' },
      { input: '', desc: 'empty string' },
      { input: '   ', desc: 'whitespace-only string' },
      { input: '\t', desc: 'tab-only string' },
      { input: '\n', desc: 'newline-only string' },
      { input: 0, desc: 'number zero' },
      { input: false, desc: 'boolean false' },
      { input: {}, desc: 'object' },
    ])('should return error message for $desc', ({ input }) => {
      const result = validateRequiredString(input as unknown as string, 'title');
      expect(result).toBe('title is required');
    });
  });

  it('should include fieldName in error message', () => {
    expect(validateRequiredString('', 'username')).toBe('username is required');
    expect(validateRequiredString(null, 'email')).toBe('email is required');
  });
});
