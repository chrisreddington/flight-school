import { describe, expect, it } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a boolean', false],
    ['a string', 'hello'],
  ])('returns an error message when value is %s', (_label, value) => {
    const result = validateObject(value, 'RequestBody');
    expect(result).toBe('RequestBody is required and must be an object');
  });

  it.each([
    ['a plain object', { key: 'value' }],
    ['an empty object', {}],
    ['an array', ['a', 'b']],
  ])('returns null when value is %s', (_label, value) => {
    expect(validateObject(value, 'RequestBody')).toBeNull();
  });

  it('includes the fieldName in the error message', () => {
    const result = validateObject(null, 'myField');
    expect(result).toContain('myField');
  });
});

describe('validateRequiredString', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a boolean', true],
    ['an empty string', ''],
    ['a whitespace-only string', '   '],
    ['a tab-only string', '\t'],
  ])('returns an error message when value is %s', (_label, value) => {
    const result = validateRequiredString(value, 'title');
    expect(result).toBe('title is required');
  });

  it.each([
    ['a normal string', 'hello'],
    ['a string with surrounding spaces', '  hello  '],
    ['a single character', 'x'],
  ])('returns null when value is %s', (_label, value) => {
    expect(validateRequiredString(value, 'title')).toBeNull();
  });

  it('includes the fieldName in the error message', () => {
    const result = validateRequiredString('', 'description');
    expect(result).toContain('description');
  });
});
