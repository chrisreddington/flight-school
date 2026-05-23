import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * Resolved gate value for the `?include=` query parameter on the
 * activity routes. `full` unlocks `output.fullResponse` on the public
 * DTO, but only in development. Production always falls back to `public`.
 */
export type IncludeMode = 'full' | 'public';

/**
 * Centralised resolver for the `?include=` query parameter on every
 * activity surface (worker snapshot + stream + web proxy). The DTO
 * itself keeps a defence-in-depth dev gate inside `toPublicActivityEvent`,
 * but this helper is the canonical entry point so that the include
 * policy lives in one place.
 */
export function resolveIncludeMode(request: NextRequest): IncludeMode {
  const raw = request.nextUrl.searchParams.get('include');
  if (raw === 'full' && process.env.NODE_ENV === 'development') return 'full';
  return 'public';
}
