import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    [null, 'Body', 'Body is required and must be an object'],
    [undefined, 'Body', 'Body is required and must be an object'],
    [0, 'Body', 'Body is required and must be an object'],
    [42, 'Body', 'Body is required and must be an object'],
    ['string', 'Body', 'Body is required and must be an object'],
    [true, 'Body', 'Body is required and must be an object'],
    [false, 'Body', 'Body is required and must be an object'],
  ])('should return error for non-object %p with fieldName %p', (value, fieldName, expected) => {
    expect(validateObject(value, fieldName)).toBe(expected);
  });

  it('should include the field name in the error message', () => {
    expect(validateObject(null, 'Request body')).toBe('Request body is required and must be an object');
    expect(validateObject(null, 'payload')).toBe('payload is required and must be an object');
  });

  it.each([
    [{}, 'Body'],
    [{ key: 'value' }, 'Request body'],
    [{ nested: { a: 1 } }, 'Data'],
    [[], 'Items'],
  ])('should return null for valid object %p', (value, fieldName) => {
    expect(validateObject(value, fieldName)).toBeNull();
  });
});

describe('validateRequiredString', () => {
  it.each([
    [null, 'title'],
    [undefined, 'title'],
    [42, 'title'],
    [true, 'title'],
    [{}, 'title'],
    ['', 'title'],
    ['   ', 'title'],
  ])('should return error for invalid string %p with fieldName %p', (value, fieldName) => {
    expect(validateRequiredString(value, fieldName)).toBe(`${fieldName} is required`);
  });

  it('should include the field name in the error message', () => {
    expect(validateRequiredString('', 'description')).toBe('description is required');
    expect(validateRequiredString('', 'username')).toBe('username is required');
  });

  it.each([
    ['hello', 'title'],
    ['  hello  ', 'title'],
    ['a', 'name'],
    ['multi word string', 'content'],
  ])('should return null for valid string %p', (value, fieldName) => {
    expect(validateRequiredString(value, fieldName)).toBeNull();
  });
});
