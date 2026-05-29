import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMonacoCancellationError, registerMonacoCancellationSuppressor } from './suppress-monaco-cancellation';

function makeCanceledError(stack: string): Error {
  const error = new Error('Canceled');
  error.name = 'Canceled';
  error.stack = stack;
  return error;
}

describe('isMonacoCancellationError', () => {
  it('recognizes Monaco cancellation errors by their canceled shape and stack origin', () => {
    const fromMonaco = makeCanceledError(
      'Error: Canceled\n  at cancel (monaco-editor@0.55.1/editor.api-CalNCsUg.js:1:1)',
    );
    expect(isMonacoCancellationError(fromMonaco)).toBe(true);
  });

  it('ignores canceled-shaped errors that did not originate in Monaco', () => {
    const fromOtherLibrary = makeCanceledError('Error: Canceled\n  at abort (some-other-package/index.js:1:1)');
    expect(isMonacoCancellationError(fromOtherLibrary)).toBe(false);
  });

  it('ignores Monaco-stacked errors that are not the canceled shape', () => {
    const realMonacoBug = new Error('Cannot read properties of undefined');
    realMonacoBug.stack = 'TypeError\n  at editor.api-CalNCsUg.js:1:1';
    expect(isMonacoCancellationError(realMonacoBug)).toBe(false);
  });

  it('ignores non-error values', () => {
    expect(isMonacoCancellationError('Canceled')).toBe(false);
    expect(isMonacoCancellationError(null)).toBe(false);
    expect(isMonacoCancellationError(undefined)).toBe(false);
  });
});

describe('registerMonacoCancellationSuppressor', () => {
  const registeredListeners: Array<{ type: string; listener: EventListenerOrEventListenerObject }> = [];

  afterEach(() => {
    for (const { type, listener } of registeredListeners) {
      window.removeEventListener(type, listener, true);
    }
    registeredListeners.length = 0;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function captureRegistration(): void {
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      registeredListeners.push({ type, listener: listener as EventListenerOrEventListenerObject });
      return original(type, listener, options);
    });
  }

  it('stops a Monaco cancellation rejection from reaching later listeners', () => {
    captureRegistration();
    registerMonacoCancellationSuppressor();

    const reason = makeCanceledError('Error: Canceled\n  at cancel (monaco-editor/editor.api.js:1:1)');
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = reason;
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');
    const preventDefault = vi.spyOn(event, 'preventDefault');

    window.dispatchEvent(event);

    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves unrelated rejections untouched', () => {
    captureRegistration();
    registerMonacoCancellationSuppressor();

    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('genuine bug');
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    window.dispatchEvent(event);

    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });

  it('does nothing in production builds', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const addEventListener = vi.spyOn(window, 'addEventListener');

    registerMonacoCancellationSuppressor();

    expect(addEventListener).not.toHaveBeenCalled();
  });
});
