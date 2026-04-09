/**
 * API Validation Utilities Tests
 *
 * Tests for validateObject and validateRequiredString.
 * Both are pure functions with no external dependencies.
 */

import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

// =============================================================================
// validateObject
// =============================================================================

describe('validateObject', () => {
  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('should return null for an array (arrays are objects)', () => {
    expect(validateObject([1, 2, 3], 'items')).toBeNull();
  });

  it('should return an error message for null', () => {
    const result = validateObject(null, 'body');
    expect(result).not.toBeNull();
  });

  it('should return an error message for undefined', () => {
    const result = validateObject(undefined, 'body');
    expect(result).not.toBeNull();
  });

  it('should return an error message for a string', () => {
    expect(validateObject('hello', 'body')).not.toBeNull();
  });

  it('should return an error message for a number', () => {
    expect(validateObject(42, 'body')).not.toBeNull();
  });

  it('should return an error message for a boolean', () => {
    expect(validateObject(true, 'body')).not.toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const result = validateObject(null, 'Request body');
    expect(result).toContain('Request body');
  });

  it.each([
    [null, 'myField'],
    [undefined, 'anotherField'],
    [123, 'numericField'],
  ])('should include fieldName in error for value %p', (value, fieldName) => {
    const result = validateObject(value, fieldName);
    expect(result).toContain(fieldName);
  });
});

// =============================================================================
// validateRequiredString
// =============================================================================

describe('validateRequiredString', () => {
  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'name')).toBeNull();
  });

  it('should return an error message for an empty string', () => {
    expect(validateRequiredString('', 'name')).not.toBeNull();
  });

  it('should return an error message for a whitespace-only string', () => {
    expect(validateRequiredString('   ', 'name')).not.toBeNull();
  });

  it('should return an error message for null', () => {
    expect(validateRequiredString(null, 'name')).not.toBeNull();
  });

  it('should return an error message for undefined', () => {
    expect(validateRequiredString(undefined, 'name')).not.toBeNull();
  });

  it('should return an error message for a number', () => {
    expect(validateRequiredString(42, 'count')).not.toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const result = validateRequiredString('', 'title');
    expect(result).toContain('title');
  });

  it.each([
    ['', 'title'],
    ['  ', 'description'],
    [null, 'author'],
    [undefined, 'category'],
  ])('should report error containing fieldName for value %p', (value, fieldName) => {
    const result = validateRequiredString(value, fieldName);
    expect(result).toContain(fieldName);
  });

  it('should accept strings with leading/trailing spaces as valid (only pure whitespace fails)', () => {
    expect(validateRequiredString('  hello  ', 'name')).toBeNull();
  });
});
