/**
 * Tests for API validation utilities.
 *
 * Covers all validation rules for validateObject and validateRequiredString.
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  describe('valid objects', () => {
    it.each([
      { value: {}, desc: 'empty object' },
      { value: { key: 'value' }, desc: 'object with properties' },
      { value: [], desc: 'array (is an object)' },
      { value: { nested: { a: 1 } }, desc: 'nested object' },
    ])('should return null for $desc', ({ value }) => {
      expect(validateObject(value, 'body')).toBeNull();
    });
  });

  describe('invalid values', () => {
    it.each([
      { value: null, desc: 'null' },
      { value: undefined, desc: 'undefined' },
      { value: 0, desc: 'number zero' },
      { value: 42, desc: 'positive number' },
      { value: '', desc: 'empty string' },
      { value: 'hello', desc: 'non-empty string' },
      { value: false, desc: 'false boolean' },
      { value: true, desc: 'true boolean' },
    ])('should return error message for $desc', ({ value }) => {
      const result = validateObject(value, 'Request body');
      expect(result).toBe('Request body is required and must be an object');
    });
  });

  it('should include the fieldName in the error message', () => {
    expect(validateObject(null, 'myField')).toBe('myField is required and must be an object');
    expect(validateObject(null, 'settings')).toBe('settings is required and must be an object');
  });
});

describe('validateRequiredString', () => {
  describe('valid strings', () => {
    it.each([
      { value: 'hello', desc: 'simple string' },
      { value: 'a', desc: 'single character' },
      { value: '  hello  ', desc: 'string with surrounding whitespace (non-empty content)' },
      { value: 'hello world', desc: 'string with spaces in middle' },
      { value: '123', desc: 'numeric string' },
    ])('should return null for $desc', ({ value }) => {
      expect(validateRequiredString(value, 'field')).toBeNull();
    });
  });

  describe('invalid values', () => {
    it.each([
      { value: null, desc: 'null' },
      { value: undefined, desc: 'undefined' },
      { value: '', desc: 'empty string' },
      { value: '   ', desc: 'whitespace-only string' },
      { value: '\t', desc: 'tab-only string' },
      { value: '\n', desc: 'newline-only string' },
      { value: 0, desc: 'number' },
      { value: false, desc: 'boolean false' },
      { value: {}, desc: 'object' },
    ])('should return error message for $desc', ({ value }) => {
      const result = validateRequiredString(value as unknown as string, 'title');
      expect(result).toBe('title is required');
    });
  });

  it('should include the fieldName in the error message', () => {
    expect(validateRequiredString('', 'username')).toBe('username is required');
    expect(validateRequiredString('', 'email')).toBe('email is required');
  });
});
