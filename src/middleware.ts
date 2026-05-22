/**
 * Next.js middleware: gates the app behind Auth.js.
 *
 * - Public paths (auth endpoints, health, sign-in, Next internals, static
 *   assets) are always allowed.
 * - Unauthenticated UI requests are redirected to `/sign-in`.
 * - Unauthenticated `/api/*` requests get a JSON 401.
 */

import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';

import { edgeAuthConfig } from '@/lib/auth/edge-config';

if (!process.env.AUTH_SECRET) {
  // Without AUTH_SECRET, NextAuth's edge middleware silently no-ops: every
  // request bypasses the gate and unauthenticated UI/API traffic reaches the
  // app. Fail loudly at boot so this footgun never makes it to a running
  // server, in any environment.
  throw new Error(
    'AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and ' +
      'add it (plus AUTH_GITHUB_ID and AUTH_GITHUB_SECRET) to .env.local. See ' +
      'docs/migrations/2025-multitenant-auth.md.'
  );
}

const { auth } = NextAuth(edgeAuthConfig);

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/health',
  '/api/_internal',
  '/sign-in',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  // Common static asset extensions served from /public.
  return /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|map|txt|woff2?|ttf)$/i.test(pathname);
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (req.auth) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const signInUrl = new URL('/sign-in', nextUrl.origin);
  const callbackPath = `${pathname}${nextUrl.search}`;
  if (callbackPath && callbackPath !== '/') {
    signInUrl.searchParams.set('callbackUrl', callbackPath);
  }
  return NextResponse.redirect(signInUrl);
});

export const config = {
  // Match everything except Next internals and obvious static asset files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|map|woff2?|ttf)$).*)'],
};
