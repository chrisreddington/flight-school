'use client';

/**
 * Debug Mode Context
 * 
 * Provides global debug mode state that controls:
 * - Display of tool names in "Used X tools" messages
 * - Display of performance metrics (First token, Total, Cold start/Pool hit)
 * - Availability of AI Activity Panel (CMD+SHIFT+A)
 */

import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';

interface DebugContextValue {
  /** Whether debug mode is enabled */
  isDebugMode: boolean;
  /** Toggle debug mode on/off */
  toggleDebugMode: () => void;
  /** Set debug mode to a specific value */
  setDebugMode: (enabled: boolean) => void;
}

const DebugContext = createContext<DebugContextValue | undefined>(undefined);

const DEBUG_STORAGE_KEY = 'dev-growth-debug-mode';
const debugModeListeners = new Set<() => void>();

const getDebugSnapshot = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return localStorage.getItem(DEBUG_STORAGE_KEY) === 'true';
};

const getDebugServerSnapshot = (): boolean => false;

const notifyDebugModeChange = () => {
  debugModeListeners.forEach((listener) => listener());
};

const subscribeToDebugMode = (listener: () => void) => {
  debugModeListeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEBUG_STORAGE_KEY) {
      listener();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }

  return () => {
    debugModeListeners.delete(listener);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
};

export function DebugProvider({ children }: { children: React.ReactNode }) {
  const isDebugMode = useSyncExternalStore(
    subscribeToDebugMode,
    getDebugSnapshot,
    getDebugServerSnapshot
  );

  const toggleDebugMode = useCallback(() => {
    if (typeof window === 'undefined') return;
    const newValue = !isDebugMode;
    localStorage.setItem(DEBUG_STORAGE_KEY, String(newValue));
    notifyDebugModeChange();
  }, [isDebugMode]);

  const setDebugMode = useCallback((enabled: boolean) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(DEBUG_STORAGE_KEY, String(enabled));
    notifyDebugModeChange();
  }, []);

  return (
    <DebugContext.Provider value={{ isDebugMode, toggleDebugMode, setDebugMode }}>
      {children}
    </DebugContext.Provider>
  );
}

/**
 * Hook to access debug mode state
 */
export function useDebugMode() {
  const context = useContext(DebugContext);
  if (context === undefined) {
    throw new Error('useDebugMode must be used within a DebugProvider');
  }
  return context;
}
