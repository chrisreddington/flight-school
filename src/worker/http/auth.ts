/**
 * Worker HTTP auth helpers.
 *
 * Two shapes:
 *   - `requireBearer(request)` — checks `Authorization: Bearer
 *     ${COPILOT_WORKER_SECRET}`. Used as Hono middleware on the
 *     `/api/internal/*` group.
 *   - `requireUserId(request)` — extracts and validates `x-user-id`.
 *     Used on the routes that take subject in a header
 *     (`/api/internal/ai-activity/*` and `/api/internal/jobs/:id/stream`).
 *
 * Startup must call `assertWorkerSecretConfigured()` so an unset
 * `COPILOT_WORKER_SECRET` exits the process non-zero instead of
 * returning 500 per request.
 */

function getConfiguredSecret(): string | null {
  const secret = process.env.COPILOT_WORKER_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

export function assertWorkerSecretConfigured(): void {
  if (!getConfiguredSecret()) {
    throw new Error(
      'COPILOT_WORKER_SECRET is not configured — worker refuses to start.',
    );
  }
}

export function checkBearer(request: Request): Response | null {
  const secret = getConfiguredSecret();
  if (!secret) {
    return Response.json(
      { error: 'COPILOT_WORKER_SECRET is not configured' },
      { status: 500 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export function requireUserId(
  request: Request,
): { ok: true; userId: string } | { ok: false; response: Response } {
  const userId = request.headers.get('x-user-id')?.trim();
  if (!userId) {
    return {
      ok: false,
      response: Response.json(
        { error: 'x-user-id header is required' },
        { status: 400 },
      ),
    };
  }
  return { ok: true, userId };
}
