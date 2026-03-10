/**
 * Tests for API Validation Utilities.
 */

import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    [0, 'body', 'body is required and must be an object'],
    ['', 'body', 'body is required and must be an object'],
    ['hello', 'payload', 'payload is required and must be an object'],
    [42, 'data', 'data is required and must be an object'],
    [true, 'req', 'req is required and must be an object'],
    [false, 'req', 'req is required and must be an object'],
  ])('should return an error for non-object value %p (%s)', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it('should return null for an array (which is typeof object)', () => {
    expect(validateObject([], 'items')).toBeNull();
  });

  it('should include fieldName in the error message', () => {
    const result = validateObject(null, 'requestBody');
    expect(result).toContain('requestBody');
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title', 'title is required'],
    [undefined, 'title', 'title is required'],
    [0, 'title', 'title is required'],
    [42, 'count', 'count is required'],
    [true, 'flag', 'flag is required'],
    [{}, 'name', 'name is required'],
    ['', 'name', 'name is required'],
    ['   ', 'name', 'name is required'],
    ['\t\n', 'name', 'name is required'],
  ])('should return an error for invalid value %p (%s)', (value, fieldName, expected) => {
    expect(validateRequiredString(value, fieldName)).toBe(expected);
  });

  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'title')).toBeNull();
  });

  it('should return null for a string with only leading/trailing spaces but content inside', () => {
    expect(validateRequiredString('  hello  ', 'title')).toBeNull();
  });

  it('should include fieldName in the error message', () => {
    const result = validateRequiredString('', 'myField');
    expect(result).toContain('myField');
  });
});
