import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { activeSlotId, assertSafeSegment, slotKey, stepInstanceId } from './ids';

describe('assertSafeSegment', () => {
  it('accepts alphanumeric, underscore, and hyphen segments', () => {
    expect(() => assertSafeSegment('github-actions_101')).not.toThrow();
  });

  it.each(['github/actions', '..', 'a.b', '', 'has space', 'tab\tchar'])('rejects unsafe segment %p', (unsafe) => {
    expect(() => assertSafeSegment(unsafe)).toThrow(/unsafe/i);
  });
});

describe('slotKey', () => {
  it('returns the validated trackId unchanged', () => {
    expect(slotKey('intro-to-git')).toBe('intro-to-git');
  });

  it('throws on an unsafe trackId rather than producing a traversal key', () => {
    expect(() => slotKey('../escape')).toThrow(/unsafe/i);
  });
});

describe('activeSlotId', () => {
  it('prefixes the slot key with "active-"', () => {
    expect(activeSlotId('intro-to-git')).toBe('active-intro-to-git');
  });

  it('throws on an unsafe trackId', () => {
    expect(() => activeSlotId('a/b')).toThrow(/unsafe/i);
  });
});

describe('stepInstanceId', () => {
  it('is the sha256 of enrollmentId + NUL + stepId, "step-" prefixed', () => {
    const enrollmentId = 'enr-123';
    const stepId = 'step-one';
    const expectedHash = createHash('sha256').update(`${enrollmentId}\u0000${stepId}`).digest('hex');

    expect(stepInstanceId(enrollmentId, stepId)).toBe(`step-${expectedHash}`);
  });

  it('is deterministic for the same inputs', () => {
    expect(stepInstanceId('enr-1', 'a')).toBe(stepInstanceId('enr-1', 'a'));
  });

  it('separates fields with NUL so concatenation collisions cannot occur', () => {
    // Without the separator, ('ab','c') and ('a','bc') would hash identically.
    expect(stepInstanceId('ab', 'c')).not.toBe(stepInstanceId('a', 'bc'));
  });
});
