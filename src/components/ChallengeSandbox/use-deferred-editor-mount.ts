import { useEffect, useState } from 'react';

/**
 * Defers Monaco editor mount until after the first paint to avoid the
 * synchronous layout work that Monaco's `measureReferenceDomElement` performs
 * during initialization. Mounting Monaco eagerly causes a forced reflow that
 * blocks the initial render of the sandbox.
 *
 * Returns `true` once the editor is safe to mount.
 */
export function useDeferredEditorMount(): boolean {
  const [isEditorReady, setIsEditorReady] = useState(false);

  useEffect(() => {
    // requestIdleCallback gives the browser a budget to commit first paint
    // before we mount Monaco; fall back to rAF + a one-frame delay otherwise.
    const EDITOR_IDLE_TIMEOUT_MS = 100;
    const NEXT_FRAME_DELAY_MS = 16;
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => setIsEditorReady(true), { timeout: EDITOR_IDLE_TIMEOUT_MS });
      return () => cancelIdleCallback(id);
    } else {
      const rafId = requestAnimationFrame(() => {
        const timeoutId = setTimeout(() => setIsEditorReady(true), NEXT_FRAME_DELAY_MS);
        return () => clearTimeout(timeoutId);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, []);

  return isEditorReady;
}
