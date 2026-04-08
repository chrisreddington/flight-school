/**
 * Tests for API Validation Utilities
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    [0, 'body', 'body is required and must be an object'],
    ['string', 'field', 'field is required and must be an object'],
    [42, 'value', 'value is required and must be an object'],
    [false, 'data', 'data is required and must be an object'],
  ])(
    'should return error message for non-object value %p with fieldName %p',
    (value, fieldName, expected) => {
      expect(validateObject(value, fieldName)).toBe(expected);
    }
  );

  it.each([
    [{ key: 'value' }, 'body'],
    [{}, 'body'],
    [[], 'items'],
    [{ nested: { a: 1 } }, 'data'],
  ])(
    'should return null for valid object %p',
    (value, fieldName) => {
      expect(validateObject(value, fieldName)).toBeNull();
    }
  );
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title', 'title is required'],
    [undefined, 'title', 'title is required'],
    ['', 'name', 'name is required'],
    ['   ', 'description', 'description is required'],
    ['\t\n', 'label', 'label is required'],
    [0, 'id', 'id is required'],
    [false, 'flag', 'flag is required'],
    [{}, 'data', 'data is required'],
  ])(
    'should return error for invalid string value %p with fieldName %p',
    (value, fieldName, expected) => {
      expect(validateRequiredString(value, fieldName)).toBe(expected);
    }
  );

  it.each([
    ['hello', 'title'],
    ['  hello  ', 'title'],
    ['a', 'id'],
    ['Some text here', 'description'],
  ])(
    'should return null for valid non-empty string %p',
    (value, fieldName) => {
      expect(validateRequiredString(value, fieldName)).toBeNull();
    }
  );
});
