import { afterEach, describe, expect, it } from 'vitest';

import { __getSlotCount, __resetSessionCapState, acquireSlot, TooManyConcurrentSessionsError } from './session-cap';

describe('acquireSlot', () => {
  afterEach(() => {
    __resetSessionCapState();
  });

  it('grants slots up to max and rejects further attempts', async () => {
    const r1 = await acquireSlot('user-1', 2);
    const r2 = await acquireSlot('user-1', 2);
    expect(__getSlotCount('user-1')).toBe(2);

    await expect(acquireSlot('user-1', 2)).rejects.toBeInstanceOf(TooManyConcurrentSessionsError);

    r1();
    expect(__getSlotCount('user-1')).toBe(1);
    r2();
    expect(__getSlotCount('user-1')).toBe(0);
  });

  it('release function is idempotent', async () => {
    const release = await acquireSlot('user-1', 1);
    release();
    release();
    expect(__getSlotCount('user-1')).toBe(0);
  });

  it('keeps counters independent per user', async () => {
    await acquireSlot('user-a', 1);
    const slot = await acquireSlot('user-b', 1);
    expect(__getSlotCount('user-a')).toBe(1);
    expect(__getSlotCount('user-b')).toBe(1);
    slot();
    expect(__getSlotCount('user-b')).toBe(0);
    expect(__getSlotCount('user-a')).toBe(1);
  });

  it('exposes max + code on the error', async () => {
    await acquireSlot('user-1', 1);
    try {
      await acquireSlot('user-1', 1);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TooManyConcurrentSessionsError);
      const cast = err as TooManyConcurrentSessionsError;
      expect(cast.status).toBe(429);
      expect(cast.code).toBe('CONCURRENT_SESSION_LIMIT');
      expect(cast.max).toBe(1);
    }
  });
});
