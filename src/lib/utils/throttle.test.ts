import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttleRAF } from './throttle';

describe('throttleRAF', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      clearTimeout(handle as unknown as number);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('should throttle calls to the target fps', () => {
    const handler = vi.fn();
    const throttled = throttleRAF(handler);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith('first');

    vi.advanceTimersByTime(16);
    expect(handler).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(40);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith('third');
  });

  it('should cancel scheduled callbacks', () => {
    const handler = vi.fn();
    const throttled = throttleRAF(handler);

    throttled('start');
    throttled('queued');
    throttled.cancel();

    vi.runAllTimers();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenLastCalledWith('start');
  });
});
