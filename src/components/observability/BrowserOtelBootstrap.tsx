'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Client-only side-effect that boots the browser OpenTelemetry SDK on the
 * first render of the app shell and emits a `page.navigation` span on every
 * client-side route change. The OTel SDK module is dynamically imported to
 * keep it out of the SSR bundle. Idempotent — repeated mounts (e.g. from
 * React strict mode) are no-ops.
 */
export function BrowserOtelBootstrap(): null {
  const pathname = usePathname();
  const previousPathname = useRef<string | undefined>(undefined);

  useEffect(() => {
    void import('@/lib/observability/browser-otel').then((mod) => {
      mod.initBrowserOtel();
    });
  }, []);

  useEffect(() => {
    if (!pathname) return;
    const prev = previousPathname.current;
    previousPathname.current = pathname;
    void import('@/lib/observability/navigation-span').then((mod) => {
      mod.recordNavigation(pathname, prev);
    });
  }, [pathname]);

  return null;
}
