import { permanentRedirect } from 'next/navigation';

/**
 * `/dashboard` is a legacy URL preserved only because the proxy already
 * routes to it (see `src/proxy.test.ts`) and existing GitHub App / OAuth
 * configurations may still point at it. The actual home is `/`; canonicalise
 * with a 308 so the browser updates its address bar and `usePathname()`
 * never reports `/dashboard` (which would break breadcrumb analytics and
 * the `CopilotRequiredBanner` allow-list).
 */
export function GET() {
  permanentRedirect('/');
}
