/**
 * Tests for API validation utilities.
 *
 * Covers validateObject and validateRequiredString helpers.
 */

import { describe, it, expect } from 'vitest';
import { validateObject, validateRequiredString } from './validation-utils';

describe('validateObject', () => {
  it.each([
    { value: null, label: 'null', field: 'body' },
    { value: undefined, label: 'undefined', field: 'body' },
    { value: 0, label: 'zero', field: 'body' },
    { value: '', label: 'empty string', field: 'body' },
    { value: 'hello', label: 'string', field: 'body' },
    { value: 42, label: 'number', field: 'body' },
    { value: false, label: 'false', field: 'body' },
  ])('should return error for $label value', ({ value, field }) => {
    const result = validateObject(value, field);
    expect(result).toBe(`${field} is required and must be an object`);
  });

  it.each([
    { value: {}, label: 'empty object' },
    { value: { key: 'val' }, label: 'plain object' },
    { value: [], label: 'array' },
    { value: new Date(), label: 'Date instance' },
  ])('should return null for $label', ({ value }) => {
    const result = validateObject(value, 'body');
    expect(result).toBeNull();
  });

  it('should include the provided field name in the error message', () => {
    const result = validateObject(null, 'Request body');
    expect(result).toBe('Request body is required and must be an object');
  });
});

describe('validateRequiredString', () => {
  it.each([
    { value: null, label: 'null' },
    { value: undefined, label: 'undefined' },
    { value: '', label: 'empty string' },
    { value: '   ', label: 'whitespace-only string' },
    { value: '\t\n', label: 'tabs and newlines' },
    { value: 42, label: 'number' },
    { value: {}, label: 'object' },
    { value: false, label: 'boolean false' },
  ])('should return error for $label', ({ value }) => {
    const result = validateRequiredString(value, 'title');
    expect(result).toBe('title is required');
  });

  it.each([
    { value: 'hello', label: 'plain string' },
    { value: ' hello ', label: 'string with surrounding whitespace' },
    { value: 'a', label: 'single character' },
  ])('should return null for $label', ({ value }) => {
    const result = validateRequiredString(value, 'title');
    expect(result).toBeNull();
  });

  it('should include the provided field name in the error message', () => {
    const result = validateRequiredString('', 'challenge title');
    expect(result).toBe('challenge title is required');
  });
});
