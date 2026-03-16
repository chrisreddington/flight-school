import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    [42, 'body', 'body is required and must be an object'],
    ['string', 'body', 'body is required and must be an object'],
    [true, 'options', 'options is required and must be an object'],
    [[], 'list', null],
  ])('returns expected result for input %p (field: %s)', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it('returns null for a plain object', () => {
    expect(validateObject({ key: 'value' }, 'payload')).toBeNull();
  });

  it('returns null for an empty object', () => {
    expect(validateObject({}, 'payload')).toBeNull();
  });

  it('includes the fieldName in the error message', () => {
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
    ['\t\n', 'description', 'description is required'],
    [42, 'label', 'label is required'],
    [true, 'flag', 'flag is required'],
    [{}, 'data', 'data is required'],
  ])('returns error for invalid input %p (field: %s)', (value, fieldName, expected) => {
    expect(validateRequiredString(value, fieldName)).toBe(expected);
  });

  it('returns null for a valid non-empty string', () => {
    expect(validateRequiredString('hello', 'title')).toBeNull();
  });

  it('returns null for a string with leading/trailing spaces (non-empty when trimmed)', () => {
    expect(validateRequiredString('  hello  ', 'title')).toBeNull();
  });

  it('includes the fieldName in the error message', () => {
    expect(validateRequiredString('', 'Challenge title')).toBe('Challenge title is required');
  });
});
