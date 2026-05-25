/**
 * Proxy gating suite.
 *
 * Verifies the Auth.js-backed Next.js 16 proxy (formerly `middleware`):
 * - Returns 401 JSON for unauthenticated `/api/*` requests
 * - Redirects unauthenticated UI requests to `/sign-in` with a callbackUrl
 * - Lets public paths (`/api/health`, `/api/auth/*`, `/_next`, assets) through
 * - Passes authenticated requests through untouched
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (req: { auth: unknown; nextUrl: URL }) => unknown;

const { handlerRef } = vi.hoisted(() => ({ handlerRef: { fn: null as Handler | null } }));

vi.mock('next-auth', () => {
  return {
    default: () => ({
      auth: (handler: Handler) => {
        handlerRef.fn = handler;
        return (req: { auth: unknown; nextUrl: URL }) => handler(req);
      },
    }),
  };
});

vi.mock('@/lib/auth/edge-config', () => ({
  edgeAuthConfig: {},
}));

import proxy from '@/proxy';

if (!handlerRef.fn) {
  throw new Error('proxy did not register a handler');
}

function makeRequest(pathname: string, options: { authed?: boolean; search?: string } = {}) {
  const search = options.search ?? '';
  const url = new URL(`http://localhost${pathname}${search}`);
  return {
    auth: options.authed ? { user: { id: '42' } } : null,
    nextUrl: url,
  };
}

describe('proxy gating', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a 401 JSON response for unauthenticated /api/* requests', async () => {
    const res = await proxy(makeRequest('/api/profile'));
    const response = res as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it('redirects unauthenticated UI requests to /sign-in with callbackUrl', async () => {
    const res = await proxy(makeRequest('/dashboard'));
    const response = res as Response;
    expect([302, 307, 308]).toContain(response.status);
    const location = response.headers.get('location');
    expect(location).toBeTruthy();
    const loc = new URL(location as string);
    expect(loc.pathname).toBe('/sign-in');
    expect(loc.searchParams.get('callbackUrl')).toBe('/dashboard');
  });

  it('allows unauthenticated /api/health requests', async () => {
    const res = await proxy(makeRequest('/api/health'));
    const response = res as Response;
    expect(response.status).toBe(200);
  });

  it('allows unauthenticated /api/auth/* requests (Auth.js endpoints)', async () => {
    const res = await proxy(makeRequest('/api/auth/callback/github'));
    const response = res as Response;
    expect(response.status).toBe(200);
  });

  it('redirects unauthenticated /api/internal/* requests (no Next routes there post-extraction)', async () => {
    const res = await proxy(makeRequest('/api/internal/copilot/execute'));
    const response = res as Response;
    // After worker extraction, /api/internal/* exists only on the Hono worker.
    // Any browser-side hit through Next's proxy must redirect to sign-in.
    expect(response.status).toBe(401);
  });

  it('allows unauthenticated /_next/* and static assets', async () => {
    expect(((await proxy(makeRequest('/_next/static/chunk.js'))) as Response).status).toBe(200);
    expect(((await proxy(makeRequest('/favicon.ico'))) as Response).status).toBe(200);
    expect(((await proxy(makeRequest('/logo.svg'))) as Response).status).toBe(200);
  });

  it('lets authenticated requests pass through to the route', async () => {
    const res = await proxy(makeRequest('/dashboard', { authed: true }));
    const response = res as Response;
    expect(response.status).toBe(200);
  });

  it('lets authenticated /api/* requests pass through', async () => {
    const res = await proxy(makeRequest('/api/profile', { authed: true }));
    const response = res as Response;
    expect(response.status).toBe(200);
  });

  it('preserves query string in the callbackUrl when redirecting', async () => {
    const res = await proxy(makeRequest('/dashboard', { search: '?tab=focus' }));
    const response = res as Response;
    const loc = new URL(response.headers.get('location') as string);
    expect(loc.searchParams.get('callbackUrl')).toBe('/dashboard?tab=focus');
  });
});
