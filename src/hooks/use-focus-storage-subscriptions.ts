/**
 * useFocusStorageSubscriptions
 *
 * Wires up the three "refresh from storage when something changes" effects
 * for the focus dashboard:
 *
 * 1. The shared {@link operationsManager} fires (any background job state
 *    change → re-read storage so the latest regenerated content shows).
 * 2. The tab becomes visible again (user returned from another tab).
 * 3. The `FOCUS_DATA_CHANGED_EVENT` window event fires from a global handler.
 *
 * @remarks
 * All three converge on the same `refreshFromStorage` callback — extracted
 * here so the parent hook only declares one effect dependency rather than
 * three. Kept as a hook (not a util) because each effect owns its own
 * teardown.
 */

import { useEffect } from 'react';

import { logger } from '@/lib/logger';
import { FOCUS_DATA_CHANGED_EVENT, operationsManager } from '@/lib/operations';

const log = logger.withTag('useFocusStorageSubscriptions');

/**
 * @param refreshFromStorage - re-reads `focusStore.getTodaysFocus()` and
 *   updates state. Must be stable across renders (`useCallback`).
 */
export function useFocusStorageSubscriptions(refreshFromStorage: () => Promise<boolean>): void {
  // Operations manager: any state change (completion, failure, cancellation)
  // is a signal that storage may have new content for us.
  useEffect(() => {
    const unsubscribe = operationsManager.subscribe(() => {
      refreshFromStorage();
    });
    return unsubscribe;
  }, [refreshFromStorage]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        log.debug('Tab became visible, refreshing from storage');
        refreshFromStorage();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshFromStorage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleFocusDataChanged = () => {
      log.debug('Focus data changed event received, refreshing from storage');
      refreshFromStorage();
    };

    window.addEventListener(FOCUS_DATA_CHANGED_EVENT, handleFocusDataChanged);
    return () => {
      window.removeEventListener(FOCUS_DATA_CHANGED_EVENT, handleFocusDataChanged);
    };
  }, [refreshFromStorage]);
}
