/**
 * Tests for API validation utilities.
 *
 * Covers validateObject and validateRequiredString helpers.
 */

import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it('should return null for an array (arrays are objects)', () => {
    expect(validateObject([], 'body')).toBeNull();
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [0, 'zero'],
    [42, 'number'],
    ['string', 'string'],
    [false, 'false'],
    [true, 'true'],
  ])('should return an error message for %s (%s)', (value) => {
    const result = validateObject(value, 'Request body');
    expect(result).not.toBeNull();
    expect(typeof result).toBe('string');
  });

  it('should include the field name in the error message', () => {
    const result = validateObject(null, 'myField');
    expect(result).toContain('myField');
  });

  it('should return null for a nested object', () => {
    expect(validateObject({ nested: { deep: true } }, 'body')).toBeNull();
  });
});

describe('validateRequiredString', () => {
  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'name')).toBeNull();
  });

  it('should return null for a string with leading/trailing spaces but non-empty content', () => {
    expect(validateRequiredString('  hello  ', 'name')).toBeNull();
  });

  it.each([
    [null, 'null'],
    [undefined, 'undefined'],
    [42, 'number'],
    [false, 'boolean'],
    [{}, 'object'],
  ])('should return an error for non-string %s (%s)', (value) => {
    const result = validateRequiredString(value, 'field');
    expect(result).not.toBeNull();
  });

  it('should return an error for empty string', () => {
    expect(validateRequiredString('', 'title')).not.toBeNull();
  });

  it('should return an error for whitespace-only string', () => {
    expect(validateRequiredString('   ', 'title')).not.toBeNull();
  });

  it('should return an error for tab-only string', () => {
    expect(validateRequiredString('\t\n', 'title')).not.toBeNull();
  });

  it('should include the field name in the error message', () => {
    const result = validateRequiredString('', 'myField');
    expect(result).toContain('myField');
  });
});
