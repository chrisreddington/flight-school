/**
 * Breadcrumb Context
 *
 * Provides navigation history-aware breadcrumb generation.
 * Tracks the user's navigation path and builds breadcrumbs dynamically
 * based on how they arrived at the current page.
 *
 * @example
 * ```tsx
 * // In a page component
 * function MyPage() {
 *   useBreadcrumb({ label: 'My Page', href: '/my-page' });
 *   return <div>...</div>;
 * }
 * ```
 */

'use client';

import { usePathname } from 'next/navigation';
import { nowMs } from '@/lib/utils/date-utils';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useSyncExternalStore,
    type ReactNode,
} from 'react';

/** Single breadcrumb item */
export interface BreadcrumbItem {
  /** Display label */
  label: string;
  /** Link href */
  href: string;
}

/** Page registration for breadcrumb system */
interface PageRegistration {
  /** URL path pattern (e.g., '/challenge', '/history') */
  path: string;
  /** Display label */
  label: string;
  /** Full href including query params */
  href: string;
  /** Timestamp when page was visited */
  timestamp: number;
}

interface BreadcrumbContextValue {
  /** Current breadcrumb trail based on navigation history */
  breadcrumbs: BreadcrumbItem[];
  /** Register current page for breadcrumb tracking */
  registerPage: (registration: Omit<PageRegistration, 'timestamp'>) => void;
  /** Current pathname for validation */
  pathname: string;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | undefined>(
  undefined
);

/** Maximum number of pages to track in history */
const MAX_HISTORY = 10;

/**
 * Create a breadcrumb store that can be subscribed to.
 * This allows synchronous updates without violating React rules.
 */
function createBreadcrumbStore() {
  let history: PageRegistration[] = [];
  const listeners = new Set<() => void>();

  return {
    getHistory: () => history,
    
    registerPage: (registration: Omit<PageRegistration, 'timestamp'>) => {
      const timestamp = nowMs();
      const newPage: PageRegistration = { ...registration, timestamp };

      // Find if this path already exists in history
      const existingIndex = history.findIndex((p) => p.path === registration.path);

      if (existingIndex !== -1) {
        // If we're revisiting a page, remove everything after it
        history = [...history.slice(0, existingIndex + 1)].map((p, i) =>
          i === existingIndex ? newPage : p
        );
      } else {
        // New page - add to history
        history = [...history, newPage];

        // Limit history size
        if (history.length > MAX_HISTORY) {
          history = history.slice(-MAX_HISTORY);
        }
      }

      // Notify all subscribers
      listeners.forEach((listener) => listener());
    },

    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    clearHistory: () => {
      history = [];
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * BreadcrumbProvider Component
 *
 * Wraps the application to provide breadcrumb tracking.
 * Should be placed in the root layout.
 */
export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  
  // Create store once using useMemo with empty deps
  const store = useMemo(() => createBreadcrumbStore(), []);

  /**
   * Register a page visit in the navigation history.
   */
  const registerPage = useCallback((
    registration: Omit<PageRegistration, 'timestamp'>
  ) => {
    store.registerPage(registration);
  }, [store]);

  /**
   * Subscribe to store changes and compute breadcrumbs.
   */
  const history = useSyncExternalStore(
    store.subscribe,
    store.getHistory,
    store.getHistory
  );

  /**
   * Build breadcrumbs from navigation history.
   * Always starts with homepage, followed by intermediate pages, ending with current page.
   * 
   * IMPORTANT: Only return breadcrumbs if the last registered page matches current pathname.
   * This prevents flash of stale breadcrumbs during client-side navigation.
   */
  const breadcrumbs: BreadcrumbItem[] = (() => {
    if (history.length === 0) {
      return [];
    }

    // Get the last registered page
    const lastPage = history[history.length - 1];
    
    // Check if the last registered page matches current pathname
    // This prevents showing stale breadcrumbs during navigation
    // We compare base paths (without query params) to handle dynamic routes
    const currentBasePath = pathname.split('?')[0];
    const lastBasePath = lastPage.path.split('?')[0];
    
    // If paths don't match, don't show any breadcrumbs yet
    // The page's useBreadcrumb hook will register and trigger a re-render
    if (currentBasePath !== lastBasePath) {
      return [];
    }

    // Homepage is always implicit (rendered by AppHeader logo)
    // Build trail from history, excluding homepage
    const trail = history
      .filter((page) => page.path !== '/')
      .map((page, index, arr) => ({
        label: page.label,
        // All items except the last one should be clickable
        href: index < arr.length - 1 ? page.href : '',
      }));

    return trail;
  })();

  // Clear history when returning to homepage via direct navigation
  useEffect(() => {
    if (pathname === '/' && history.length > 0) {
      const lastPage = history[history.length - 1];
      // Only clear if we're not coming from a registration
      // (e.g., user typed URL directly or external link)
      if (lastPage && lastPage.path !== '/') {
        // Schedule history clear on next tick to avoid synchronous setState in effect
        const timer = setTimeout(() => {
          store.clearHistory();
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [pathname, history, store]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, registerPage, pathname }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/**
 * Hook to access breadcrumb context
 */
export function useBreadcrumbContext(): BreadcrumbContextValue {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error(
      'useBreadcrumbContext must be used within BreadcrumbProvider'
    );
  }
  return context;
}

/**
 * Hook to register current page in breadcrumb history
 *
 * Uses useSyncExternalStore pattern for immediate synchronous updates
 * without causing React state update warnings.
 *
 * @param path - URL path pattern (e.g., '/challenge', '/history')
 * @param label - Display label for the breadcrumb
 * @param href - Full href including query params
 *
 * @example
 * ```tsx
 * function ChallengePage() {
 *   const searchParams = useSearchParams();
 *   const title = searchParams.get('title') || 'Challenge';
 *
 *   useBreadcrumb('/challenge', title, `/challenge?title=${title}`);
 *
 *   return <div>...</div>;
 * }
 * ```
 */
export function useBreadcrumb(path: string, label: string, href: string) {
  const { registerPage } = useBreadcrumbContext();

  // Register on mount and when values change
  // This happens synchronously in the store without triggering React warnings
  useEffect(() => {
    registerPage({ path, label, href });
  }, [registerPage, path, label, href]);
}
