/**
 * Throttling helpers for UI event streams.
 */

const DEFAULT_FPS = 30;
const MS_PER_SECOND = 1000;

type FrameHandle = number | ReturnType<typeof globalThis.setTimeout>;

/**
 * A throttled function with a cancel method.
 */
export interface ThrottledFn<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  cancel: () => void;
}

function getNow(): number {
  return Date.now();
}

function scheduleFrame(callback: FrameRequestCallback): FrameHandle {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(getNow()), 0);
}

function cancelFrame(handle: FrameHandle): void {
  if (typeof handle === 'number' && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

/**
 * Throttles a function to a target frames-per-second rate using rAF timing.
 *
 * @param callback - Function invoked at most `fps` times per second.
 * @param fps - Target frames per second (defaults to 30).
 * @returns Throttled function that can be canceled.
 *
 * @example
 * ```typescript
 * const onScroll = throttleRAF(() => {
 *   // Update UI at most 30 times per second.
 * });
 * window.addEventListener('scroll', onScroll);
 * ```
 */
export function throttleRAF<T extends (...args: unknown[]) => void>(
  callback: T,
  fps: number = DEFAULT_FPS
): ThrottledFn<T> {
  const interval = MS_PER_SECOND / fps;
  let lastInvokeTime = -interval;
  let scheduled: FrameHandle | null = null;
  let latestArgs: Parameters<T> | null = null;

  const invoke = (timestamp: number) => {
    if (!latestArgs) {
      return;
    }
    lastInvokeTime = timestamp;
    const args = latestArgs;
    latestArgs = null;
    callback(...args);
  };

  const schedule = () => {
    scheduled = scheduleFrame((timestamp) => {
      scheduled = null;
      if (!latestArgs) {
        return;
      }
      const elapsed = timestamp - lastInvokeTime;
      if (elapsed >= interval) {
        invoke(timestamp);
        return;
      }
      schedule();
    });
  };

  const throttled: ThrottledFn<T> = (...args: Parameters<T>) => {
    latestArgs = args;
    const elapsed = getNow() - lastInvokeTime;

    if (elapsed >= interval && scheduled === null) {
      invoke(getNow());
      return;
    }

    if (scheduled === null) {
      schedule();
    }
  };

  throttled.cancel = () => {
    if (scheduled !== null) {
      cancelFrame(scheduled);
      scheduled = null;
    }
    latestArgs = null;
  };

  return throttled;
}
