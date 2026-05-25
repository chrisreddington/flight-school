import { beforeEach, describe, expect, it } from 'vitest';

import { __resetCursorStoreForTests, evictCursor, getCursor, setCursor } from './cursor-store';

beforeEach(() => {
  __resetCursorStoreForTests();
});

describe('cursor-store', () => {
  it('returns 0 for unknown jobs', () => {
    expect(getCursor('nope')).toBe(0);
  });

  it('stores and retrieves a cursor', () => {
    setCursor('j1', 5);
    expect(getCursor('j1')).toBe(5);
  });

  it('does not regress to a lower cursor', () => {
    setCursor('j1', 10);
    setCursor('j1', 3);
    expect(getCursor('j1')).toBe(10);
  });

  it('rejects negative or non-finite cursors', () => {
    setCursor('j1', -1);
    setCursor('j1', Number.NaN);
    setCursor('j1', Number.POSITIVE_INFINITY);
    expect(getCursor('j1')).toBe(0);
  });

  it('evicts cursors', () => {
    setCursor('j1', 5);
    evictCursor('j1');
    expect(getCursor('j1')).toBe(0);
  });
});
