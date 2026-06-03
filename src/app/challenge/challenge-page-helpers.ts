'use client';

import { useEffect } from 'react';

/**
 * Warms Monaco in idle time so opening the sandbox editor feels instant.
 */
export function useMonacoPreload() {
  useEffect(() => {
    const preloadMonaco = () => {
      import('@monaco-editor/react').catch(() => {
        /* fall through to on-demand load */
      });
    };

    if ('requestIdleCallback' in window) {
      const idleCallbackId = window.requestIdleCallback(preloadMonaco, { timeout: 2000 });
      return () => window.cancelIdleCallback(idleCallbackId);
    }

    const timeoutId = setTimeout(preloadMonaco, 100);
    return () => clearTimeout(timeoutId);
  }, []);
}
