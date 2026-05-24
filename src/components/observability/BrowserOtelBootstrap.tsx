'use client';

import { initBrowserOtel } from '@/lib/observability/browser-otel';

// Bootstrap the browser OTel SDK and start the first `page.view` span at
// module-evaluation time on the client. This runs strictly before any
// component renders or any `useEffect` fires, which is the only way to
// guarantee that mount-time fetches issued by deeply-nested children
// inherit the `page.view` span as their parent. (`useEffect` in this
// component would fire AFTER children's effects — React fires child
// effects before parents — so a layout-effect-driven init mis-parents
// the very fetches we are trying to group.)
//
// `initBrowserOtel` is internally idempotent. SSR has no `window`, so
// the call is a no-op until the client hydrates.
if (typeof window !== 'undefined') {
  initBrowserOtel();
}

/**
 * Renders nothing. Its sole purpose is to import this module so the
 * client-side bootstrap above runs during initial client evaluation.
 *
 * Route-bounded `page.view` span management lives inside the OTel layer
 * itself — see `src/lib/observability/route-tracking.ts`. We deliberately
 * do NOT drive it from a `usePathname` effect: React parent effects fire
 * AFTER child effects, so any layout-level navigation listener would
 * update the active span after the new route's children have already
 * issued their mount-time fetches, mis-parenting them. The OTel module
 * instead patches `history.pushState`/`replaceState` directly, which
 * fires synchronously with the App Router and gets the correct ordering
 * for free.
 */
export function BrowserOtelBootstrap(): null {
  return null;
}
