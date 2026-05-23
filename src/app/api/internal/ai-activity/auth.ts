/**
 * Worker-internal authorisation helper for the AI activity routes.
 *
 * All routes under `/api/internal/ai-activity/*` share the same gate:
 *  - `COPILOT_WORKER_MODE === '1'` else 404
 *  - `Authorization: Bearer ${COPILOT_WORKER_SECRET}` else 401
 *  - `x-user-id` header else 400 — this is the authoritative subject;
 *    body / query userId is never authoritative.
 *
 * Mirrors the pattern in `src/app/api/internal/jobs/[id]/stream/route.ts`.
 */
import { NextRequest, NextResponse } from 'next/server';

export interface InternalActivityAuth {
  userId: string;
}

export function authorizeInternalActivity(
  request: NextRequest,
): { ok: true; auth: InternalActivityAuth } | { ok: false; response: NextResponse } {
  if (process.env.COPILOT_WORKER_MODE !== '1') {
    return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }
  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'COPILOT_WORKER_SECRET is not configured' },
        { status: 500 },
      ),
    };
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const userId = request.headers.get('x-user-id')?.trim();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'x-user-id header is required' }, { status: 400 }),
    };
  }
  return { ok: true, auth: { userId } };
}
