import { describe, expect, it } from 'vitest';

import { assertExclusiveCas, canonicalizeBody } from './canonical';
import { DocumentConflictError } from './types';

describe('canonicalizeBody', () => {
  it('produces identical output regardless of object key insertion order', () => {
    const first = canonicalizeBody({ b: 1, a: 2, c: 3 });
    const second = canonicalizeBody({ c: 3, a: 2, b: 1 });
    expect(first).toBe(second);
  });

  it('sorts nested object keys recursively', () => {
    const nested = canonicalizeBody({ outer: { z: 1, a: 2 } });
    expect(nested).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('drops keys whose value is undefined so absent and undefined match', () => {
    const withUndefined = canonicalizeBody({ a: 1, b: undefined });
    const withoutKey = canonicalizeBody({ a: 1 });
    expect(withUndefined).toBe(withoutKey);
    expect(withUndefined).toBe('{"a":1}');
  });

  it('preserves null as a meaningful value', () => {
    expect(canonicalizeBody(null)).toBe('null');
    expect(canonicalizeBody({ profile: null })).toBe('{"profile":null}');
  });

  it('distinguishes a null field from a dropped undefined field', () => {
    const nullField = canonicalizeBody({ a: null });
    const undefinedField = canonicalizeBody({ a: undefined });
    expect(nullField).not.toBe(undefinedField);
    expect(nullField).toBe('{"a":null}');
    expect(undefinedField).toBe('{}');
  });

  it('keeps array order significant and canonicalises array elements', () => {
    const forward = canonicalizeBody([{ b: 1, a: 2 }, 3]);
    const reordered = canonicalizeBody([3, { b: 1, a: 2 }]);
    expect(forward).toBe('[{"a":2,"b":1},3]');
    expect(forward).not.toBe(reordered);
  });

  it('coerces an undefined array element to null to keep length stable', () => {
    expect(canonicalizeBody([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('round-trips primitives', () => {
    expect(canonicalizeBody('text')).toBe('"text"');
    expect(canonicalizeBody(42)).toBe('42');
    expect(canonicalizeBody(true)).toBe('true');
  });

  it('detects real divergence between two bodies', () => {
    const original = canonicalizeBody({ challenges: [{ id: 'x' }], lastUpdated: '2026-01-01' });
    const changed = canonicalizeBody({ challenges: [{ id: 'y' }], lastUpdated: '2026-01-01' });
    expect(original).not.toBe(changed);
  });
});

describe('assertExclusiveCas', () => {
  it('throws a DocumentConflictError when both ifMatch and ifNoneMatch are set', () => {
    expect(() => assertExclusiveCas({ ifMatch: 'etag-1', ifNoneMatch: '*' })).toThrow(DocumentConflictError);
  });

  it('accepts ifMatch alone, ifNoneMatch alone, and neither', () => {
    expect(() => assertExclusiveCas({ ifMatch: 'etag-1' })).not.toThrow();
    expect(() => assertExclusiveCas({ ifNoneMatch: '*' })).not.toThrow();
    expect(() => assertExclusiveCas({})).not.toThrow();
  });
});
