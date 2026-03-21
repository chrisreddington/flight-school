import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'body', 'body is required and must be an object'],
    [undefined, 'body', 'body is required and must be an object'],
    [42, 'payload', 'payload is required and must be an object'],
    ['string', 'data', 'data is required and must be an object'],
    [false, 'input', 'input is required and must be an object'],
    [true, 'input', 'input is required and must be an object'],
  ])('should return error message for invalid input %p', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it.each([
    [{}, 'body'],
    [{ key: 'value' }, 'payload'],
    [[], 'data'],
    [{ nested: { a: 1 } }, 'input'],
  ])('should return null for valid object %p', (value, fieldName) => {
    expect(validateObject(value, fieldName)).toBeNull();
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title', 'title is required'],
    [undefined, 'title', 'title is required'],
    [42, 'name', 'name is required'],
    [{}, 'name', 'name is required'],
    ['', 'message', 'message is required'],
    ['   ', 'content', 'content is required'],
    ['\t\n', 'body', 'body is required'],
  ])('should return error message for invalid input %p', (value, fieldName, expected) => {
    expect(validateRequiredString(value, fieldName)).toBe(expected);
  });

  it.each([
    ['hello', 'title'],
    ['  hello  ', 'name'],
    ['a', 'body'],
  ])('should return null for valid string %p', (value, fieldName) => {
    expect(validateRequiredString(value, fieldName)).toBeNull();
  });
});
