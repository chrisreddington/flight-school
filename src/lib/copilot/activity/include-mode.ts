/**
 * Resolved gate value for the `?include=` query parameter on the
 * activity routes. `full` unlocks `output.fullResponse` on the public
 * DTO, but only in development. Production always falls back to `public`.
 *
 * This module is reachable from the worker import graph, so the
 * Next-compiler `'server-only'` marker is omitted — it would pull
 * Next into the worker build for no runtime gain.
 */
export type IncludeMode = 'full' | 'public';

/**
 * Resolve `?include=` mode; only `full` is allowed in development.
 *
 * Accepts a Web-standard `Request` so the helper is reachable from
 * both Next.js route handlers and the worker's Hono handlers without
 * pulling `next/server` types into the worker import graph.
 */
export function resolveIncludeMode(request: Request): IncludeMode {
  const raw = new URL(request.url).searchParams.get('include');
  if (raw === 'full' && process.env.NODE_ENV === 'development') return 'full';
  return 'public';
}
