import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

/**
 * Factory for a fresh test QueryClient + wrapper component.
 *
 * @remarks
 * Each call returns a brand-new `QueryClient` so tests cannot bleed cache
 * into each other. `retry: false` keeps error-path tests fast (TanStack's
 * default `retry: 3` with exponential backoff would blow past Vitest's
 * 5-second timeout). `gcTime: 0` evicts immediately when a hook unmounts.
 *
 * Usage:
 * ```ts
 * const { wrapper, queryClient } = createQueryTestWrapper();
 * const { result } = renderHook(() => useUserProfile(), { wrapper });
 * ```
 */
export function createQueryTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient };
}
