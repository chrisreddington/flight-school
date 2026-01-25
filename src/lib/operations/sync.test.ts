import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SYNC_FOCUS_DATA_CHANGED_EVENT,
    SYNC_THREAD_DATA_CHANGED_EVENT,
    SynchronizationService,
} from './sync';

describe('SynchronizationService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
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

  it('should notify listeners when focus data changes', () => {
    const service = new SynchronizationService();
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    window.dispatchEvent(new CustomEvent(SYNC_FOCUS_DATA_CHANGED_EVENT));

    vi.runAllTimers();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ type: 'focus-data-changed' });

    unsubscribe();
  });

  it('should include threadId for thread data changes', () => {
    const service = new SynchronizationService();
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    window.dispatchEvent(new CustomEvent(SYNC_THREAD_DATA_CHANGED_EVENT, { detail: { threadId: 't-123' } }));

    vi.runAllTimers();

    expect(listener).toHaveBeenCalledWith({ type: 'thread-data-changed', threadId: 't-123' });

    unsubscribe();
  });

  it('should stop listening after unsubscribe', () => {
    const service = new SynchronizationService();
    const listener = vi.fn();

    const unsubscribe = service.subscribe(listener);
    unsubscribe();

    window.dispatchEvent(new CustomEvent(SYNC_FOCUS_DATA_CHANGED_EVENT));
    vi.runAllTimers();

    expect(listener).not.toHaveBeenCalled();
  });
});
