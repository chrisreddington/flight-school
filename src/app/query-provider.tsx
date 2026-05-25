'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Browser-singleton TanStack QueryClient provider.
 *
 * @remarks
 * Multi-tenant invariant: this app is multi-user, and the QueryClient
 * caches per-user data (profile, threads, habits, guided plans). Today every
 * sign-out path is a full-page reload (`signOutAction redirectTo`,
 * `api-client.ts` 401 → `window.location.assign`), which re-creates the
 * QueryClient from scratch and so prevents cross-user cache bleed.
 *
 * **If a future change introduces an SPA-style sign-out** (no full reload),
 * that change MUST either call `queryClient.clear()` before the redirect OR
 * include `userId` in every query key. Otherwise user A's cached profile
 * will be served to user B until `gcTime` expires.
 *
 * The CI guard for this lives in `.github/copilot-instructions.md` (sign-out
 * invariant) — re-read before touching auth flow.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
