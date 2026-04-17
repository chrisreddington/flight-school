import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    [0, 'value', 'value is required and must be an object'],
    ['string', 'payload', 'payload is required and must be an object'],
    [42, 'data', 'data is required and must be an object'],
    [false, 'input', 'input is required and must be an object'],
  ])('should return error message for non-object: %p', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it.each([
    [{ key: 'value' }, 'body'],
    [{}, 'body'],
    [{ nested: { deep: true } }, 'payload'],
  ])('should return null for valid object: %p', (value, fieldName) => {
    expect(validateObject(value, fieldName)).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const error = validateObject(null, 'Request body');
    expect(error).toBe('Request body is required and must be an object');
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title', 'title is required'],
    [undefined, 'title', 'title is required'],
    ['', 'name', 'name is required'],
    ['   ', 'message', 'message is required'],
    ['\t\n', 'content', 'content is required'],
    [42, 'label', 'label is required'],
    [true, 'flag', 'flag is required'],
    [{}, 'data', 'data is required'],
  ])('should return error for invalid string: %p (%s)', (value, fieldName, expected) => {
    expect(validateRequiredString(value, fieldName)).toBe(expected);
  });

  it.each([
    ['hello', 'title'],
    ['  hello  ', 'title'],
    ['a', 'x'],
  ])('should return null for valid non-empty string: %p', (value, fieldName) => {
    expect(validateRequiredString(value, fieldName)).toBeNull();
  });

  it('should include the fieldName in the error message', () => {
    const error = validateRequiredString('', 'Challenge title');
    expect(error).toBe('Challenge title is required');
  });
});
