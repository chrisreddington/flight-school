/**
 * Recognizes Monaco editor's benign cancellation error.
 *
 * React StrictMode double-mounts components in development (mount, unmount,
 * remount). When that hits the Monaco editor, Monaco disposes the
 * editor/model mid-initialization and a pending operation rejects with a
 * `CancellationError` whose `name` and `message` are both exactly `Canceled`.
 * The rejection is harmless, never happens in a production build, and does
 * not affect the editor — but it misleads contributors who see it surfaced.
 *
 * The stack check keeps the match narrow so a genuine cancellation bug from
 * another library that happens to share the `Canceled` shape is never hidden.
 */
export function isMonacoCancellationError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  const hasCanceledShape = value.name === 'Canceled' && value.message === 'Canceled';
  const cameFromMonaco = /monaco-editor|editor\.api/.test(value.stack ?? '');
  return hasCanceledShape && cameFromMonaco;
}

/**
 * Keeps Monaco's benign dev-only cancellation error out of the Next.js error
 * overlay.
 *
 * Next's overlay registers its own `unhandledrejection`/`error` listeners and
 * enqueues every rejection to the overlay unconditionally — it does not check
 * `defaultPrevented`. So `preventDefault()` alone cannot suppress it; we also
 * call `stopImmediatePropagation()` and register in the capture phase so this
 * listener runs before Next's and can stop the event from reaching it.
 *
 * No-op outside the browser and in production, where the error never occurs
 * and the overlay does not exist.
 */
export function registerMonacoCancellationSuppressor(): void {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'production') return;

  const suppressIfMonacoCancellation = (candidate: unknown, event: Event): void => {
    if (!isMonacoCancellationError(candidate)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  window.addEventListener('unhandledrejection', (event) => suppressIfMonacoCancellation(event.reason, event), true);
  window.addEventListener('error', (event) => suppressIfMonacoCancellation(event.error, event), true);
}
