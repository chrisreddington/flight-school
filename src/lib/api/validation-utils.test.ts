import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    ['string', 'body', 'body is required and must be an object'],
    [42, 'body', 'body is required and must be an object'],
    [true, 'body', 'body is required and must be an object'],
    [0, 'item', 'item is required and must be an object'],
  ])('returns error for %p with fieldName %p', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it('returns null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'body')).toBeNull();
  });

  it('returns null for an empty object', () => {
    expect(validateObject({}, 'body')).toBeNull();
  });

  it('returns null for an array (typeof array is object)', () => {
    expect(validateObject([1, 2, 3], 'items')).toBeNull();
  });

  it('uses the fieldName in the error message', () => {
    const error = validateObject(null, 'Request body');
    expect(error).toBe('Request body is required and must be an object');
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title', 'title is required'],
    [undefined, 'title', 'title is required'],
    ['', 'title', 'title is required'],
    ['   ', 'title', 'title is required'],
    ['\t', 'name', 'name is required'],
    [42, 'title', 'title is required'],
    [true, 'title', 'title is required'],
    [{}, 'title', 'title is required'],
  ])('returns error for %p with fieldName %p', (value, fieldName, expected) => {
    expect(validateRequiredString(value, fieldName)).toBe(expected);
  });

  it('returns null for a non-empty string', () => {
    expect(validateRequiredString('hello', 'title')).toBeNull();
  });

  it('returns null for a string with leading/trailing spaces that has non-whitespace content', () => {
    expect(validateRequiredString('  hello  ', 'title')).toBeNull();
  });

  it('uses the fieldName in the error message', () => {
    const error = validateRequiredString('', 'Challenge title');
    expect(error).toBe('Challenge title is required');
  });
});
