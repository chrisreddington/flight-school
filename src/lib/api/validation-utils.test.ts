/**
 * Tests for API validation utilities.
 *
 * Covers all validation rules and boundary conditions for
 * validateObject and validateRequiredString.
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it('should return null for a valid plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it.each([
    { value: null, desc: 'null' },
    { value: undefined, desc: 'undefined' },
    { value: 0, desc: 'zero' },
    { value: false, desc: 'false' },
    { value: '', desc: 'empty string' },
  ])('should return error for $desc', ({ value }) => {
    const result = validateObject(value, 'Request body');
    expect(result).toBe('Request body is required and must be an object');
  });

  it.each([
    { value: 'hello', desc: 'string' },
    { value: 42, desc: 'number' },
    { value: true, desc: 'boolean' },
  ])('should return error for non-object $desc', ({ value }) => {
    const result = validateObject(value, 'body');
    expect(result).toBe('body is required and must be an object');
  });

  it('should return null for an array (arrays are objects)', () => {
    // typeof [] === 'object', so arrays pass the check
    expect(validateObject([], 'body')).toBeNull();
  });

  it('should use the provided fieldName in the error message', () => {
    const result = validateObject(null, 'Custom Field');
    expect(result).toContain('Custom Field');
  });
});

describe('validateRequiredString', () => {
  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'name')).toBeNull();
  });

  it('should return null for a string with leading/trailing spaces (non-empty after trim)', () => {
    expect(validateRequiredString('  hello  ', 'name')).toBeNull();
  });

  it.each([
    { value: null, desc: 'null' },
    { value: undefined, desc: 'undefined' },
    { value: 0, desc: 'zero' },
    { value: false, desc: 'false' },
    { value: {}, desc: 'object' },
  ])('should return error for $desc', ({ value }) => {
    const result = validateRequiredString(value, 'title');
    expect(result).toBe('title is required');
  });

  it.each([
    { value: '', desc: 'empty string' },
    { value: '   ', desc: 'whitespace only' },
    { value: '\t', desc: 'tab character' },
    { value: '\n', desc: 'newline character' },
  ])('should return error for $desc', ({ value }) => {
    const result = validateRequiredString(value, 'message');
    expect(result).toBe('message is required');
  });

  it('should use the provided fieldName in the error message', () => {
    const result = validateRequiredString('', 'User Name');
    expect(result).toBe('User Name is required');
  });
});
