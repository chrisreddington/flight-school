/**
 * Tests for API Validation Utilities
 */

import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

// =============================================================================
// validateObject Tests
// =============================================================================

describe('validateObject', () => {
  it.each([
    ['null value', null],
    ['undefined value', undefined],
    ['number value', 42],
    ['string value', 'hello'],
    ['boolean value', true],
    ['array (treated as non-plain-object — should still pass)', []],
  ])('should return error for %s', (_desc, value) => {
    if (Array.isArray(value)) {
      // Arrays ARE objects in JS — validateObject should pass for them
      expect(validateObject(value, 'body')).toBeNull();
    } else {
      expect(validateObject(value, 'body')).toBe('body is required and must be an object');
    }
  });

  it('should return null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'Request body')).toBeNull();
  });

  it('should return null for an empty object', () => {
    expect(validateObject({}, 'payload')).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const error = validateObject(null, 'Request body');
    expect(error).toBe('Request body is required and must be an object');
  });

  it('should use the provided fieldName in the error', () => {
    const error = validateObject(undefined, 'data');
    expect(error).toBe('data is required and must be an object');
  });
});

// =============================================================================
// validateRequiredString Tests
// =============================================================================

describe('validateRequiredString', () => {
  it.each([
    ['null', null, 'title is required'],
    ['undefined', undefined, 'title is required'],
    ['empty string', '', 'title is required'],
    ['whitespace-only string', '   ', 'title is required'],
    ['number', 42, 'title is required'],
    ['object', {}, 'title is required'],
    ['boolean', false, 'title is required'],
  ])('should return error for %s', (_desc, value, expected) => {
    expect(validateRequiredString(value, 'title')).toBe(expected);
  });

  it('should return null for a valid non-empty string', () => {
    expect(validateRequiredString('Hello', 'title')).toBeNull();
  });

  it('should return null for a string with content and surrounding whitespace', () => {
    // Non-empty after trim — but the function checks value.trim().length === 0
    // So " hello " should be valid (trim gives "hello", length > 0)
    expect(validateRequiredString(' hello ', 'title')).toBeNull();
  });

  it('should use the fieldName in the error message', () => {
    const error = validateRequiredString('', 'challengeId');
    expect(error).toBe('challengeId is required');
  });

  it('should return null for single-character string', () => {
    expect(validateRequiredString('a', 'code')).toBeNull();
  });
});
