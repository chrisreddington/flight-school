import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockChannel extends EventTarget {
  static instances: MockChannel[] = [];

  readonly close = vi.fn();
  readonly postMessage = vi.fn((payload: unknown) => {
    this.dispatchEvent(new MessageEvent('message', { data: payload }));
  });

  constructor(public readonly name: string) {
    super();
    MockChannel.instances.push(this);
  }
}

function resetWindowListeners() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const addEventListener = vi
    .spyOn(window, 'addEventListener')
    .mockImplementation((type, listener: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    });
  const removeEventListener = vi
    .spyOn(window, 'removeEventListener')
    .mockImplementation((type, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener);
    });
  const dispatchEvent = vi.spyOn(window, 'dispatchEvent').mockImplementation((event) => {
    const handlers = listeners.get(event.type);
    if (!handlers) return true;
    for (const handler of handlers) {
      if (typeof handler === 'function') {
        handler(event);
      } else {
        handler.handleEvent(event);
      }
    }
    return true;
  });
  return { addEventListener, removeEventListener, dispatchEvent };
}

describe('focus-broadcast', () => {
  beforeEach(() => {
    MockChannel.instances = [];
    vi.resetModules();
    vi.stubGlobal('BroadcastChannel', MockChannel as unknown as typeof BroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('broadcasts through window event and BroadcastChannel when available', async () => {
    const localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
    const windowSpies = resetWindowListeners();
    const focusBroadcastModule = await import('./focus-broadcast');
    let signalCount = 0;
    const cleanup = focusBroadcastModule.subscribeFocusInvalidate(() => {
      signalCount += 1;
    });

    focusBroadcastModule.broadcastFocusInvalidate();

    expect(windowSpies.dispatchEvent.mock.calls.length).toBeGreaterThan(0);
    expect(MockChannel.instances).toHaveLength(1);
    expect(MockChannel.instances[0].postMessage.mock.calls.length).toBe(1);
    expect(signalCount).toBe(2);
    expect(localStorageSetSpy.mock.calls.length).toBe(0);
    cleanup();
  });

  it('falls back to localStorage tick when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const localStorageSetSpy = vi.fn();
    vi.stubGlobal('localStorage', {
      setItem: localStorageSetSpy,
    });
    const focusBroadcastModule = await import('./focus-broadcast');

    focusBroadcastModule.broadcastFocusInvalidate();

    expect(localStorageSetSpy.mock.calls.length).toBe(1);
    expect(localStorageSetSpy.mock.calls[0][0]).toBe('focus-invalidate-tick');
  });

  it('subscribeFocusInvalidate cleans up all listeners and channel subscriptions', async () => {
    const focusBroadcastModule = await import('./focus-broadcast');
    let signalCount = 0;

    const cleanup = focusBroadcastModule.subscribeFocusInvalidate(() => {
      signalCount += 1;
    });
    focusBroadcastModule.broadcastFocusInvalidate();
    expect(signalCount).toBe(2);

    signalCount = 0;
    cleanup();
    focusBroadcastModule.broadcastFocusInvalidate();

    expect(signalCount).toBe(0);
  });

  it('keeps channel open until last subscriber cleanup', async () => {
    const focusBroadcastModule = await import('./focus-broadcast');

    const cleanupA = focusBroadcastModule.subscribeFocusInvalidate(() => undefined);
    const cleanupB = focusBroadcastModule.subscribeFocusInvalidate(() => undefined);

    expect(MockChannel.instances).toHaveLength(1);
    const sharedChannel = MockChannel.instances[0];

    cleanupA();
    expect(sharedChannel.close.mock.calls.length).toBe(0);

    cleanupB();
    expect(sharedChannel.close.mock.calls.length).toBe(1);

    focusBroadcastModule.subscribeFocusInvalidate(() => undefined);
    expect(MockChannel.instances).toHaveLength(2);
  });

  it('invalidates focus cache by clearing today before broadcasting', async () => {
    let clearedToday = false;
    vi.doMock('@/lib/focus/storage', () => ({
      focusStore: {
        clearTodaysFocus: vi.fn().mockImplementation(async () => {
          clearedToday = true;
        }),
      },
    }));
    const focusBroadcastModule = await import('./focus-broadcast');
    let invalidateSignals = 0;
    const cleanup = focusBroadcastModule.subscribeFocusInvalidate(() => {
      invalidateSignals += 1;
    });

    await focusBroadcastModule.invalidateFocusCache();

    expect(clearedToday).toBe(true);
    expect(invalidateSignals).toBe(2);
    cleanup();
  });
});
