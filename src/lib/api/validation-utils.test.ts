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
    ['string', 'body'],
  ])('should return error for non-object value %p', (value, fieldName) => {
    const result = validateObject(value, fieldName);
    expect(result).toBe(`${fieldName} is required and must be an object`);
  });

  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it('should return null for an array (arrays are objects)', () => {
    expect(validateObject([1, 2, 3], 'items')).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const result = validateObject(null, 'requestBody');
    expect(result).toContain('requestBody');
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'name'],
    [undefined, 'name'],
    [42, 'name'],
    [true, 'name'],
    [{}, 'name'],
  ])('should return error for non-string value %p', (value, fieldName) => {
    const result = validateRequiredString(value, fieldName);
    expect(result).toBe(`${fieldName} is required`);
  });

  it('should return error for empty string', () => {
    expect(validateRequiredString('', 'name')).toBe('name is required');
  });

  it('should return error for whitespace-only string', () => {
    expect(validateRequiredString('   ', 'name')).toBe('name is required');
  });

  it('should return error for tab-only string', () => {
    expect(validateRequiredString('\t\n', 'name')).toBe('name is required');
  });

  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'name')).toBeNull();
  });

  it('should return null for a string with only leading/trailing whitespace around content', () => {
    expect(validateRequiredString('  hello  ', 'name')).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const result = validateRequiredString('', 'challengeTitle');
    expect(result).toContain('challengeTitle');
  });
});
