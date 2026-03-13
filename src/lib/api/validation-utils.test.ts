/**
 * Tests for API validation utilities.
 */
import { describe, expect, it } from 'vitest';

import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body'],
    [undefined, 'body'],
    [42, 'body'],
    [true, 'body'],
    ['some-string', 'body'],
  ])('should return an error string for %p', (value, fieldName) => {
    const result = validateObject(value, fieldName);
    expect(typeof result).toBe('string');
    expect(result).toContain(fieldName);
  });

  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it('should return null for an array (arrays are objects)', () => {
    expect(validateObject([1, 2, 3], 'body')).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const error = validateObject(null, 'requestPayload');
    expect(error).toContain('requestPayload');
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title'],
    [undefined, 'title'],
    [42, 'title'],
    ['', 'title'],
    ['   ', 'title'],
  ])('should return an error string for %p', (value, fieldName) => {
    const result = validateRequiredString(value, fieldName);
    expect(result).toBe(`${fieldName} is required`);
  });

  it('should return null for a non-empty string', () => {
    expect(validateRequiredString('hello', 'title')).toBeNull();
  });

  it('should return null for a string with interior whitespace', () => {
    expect(validateRequiredString('hello world', 'title')).toBeNull();
  });

  it('should return null for a string with leading and trailing whitespace around content', () => {
    expect(validateRequiredString('  content  ', 'title')).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const error = validateRequiredString('', 'description');
    expect(error).toContain('description');
  });
});
