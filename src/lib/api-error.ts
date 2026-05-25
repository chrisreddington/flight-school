/**
 * API Error Handler
 *
 * Centralizes error handling for API routes. Maps error messages to
 * appropriate HTTP status codes and emits a consistent JSON envelope.
 *
 * @remarks
 * In the multi-tenant runtime each request resolves its own token from the
 * Auth.js session, so there is no process-wide token cache to invalidate
 * on auth failures. A 401/403 simply means the user needs to re-authenticate
 * via the OAuth flow.
 *
 * @example
 * ```typescript
 * export async function GET(request: Request) {
 *   const startTime = nowMs();
 *   try {
 *     // ... API logic
 *   } catch (error) {
 *     return handleApiError(error, 'GET /api/example', startTime);
 *   }
 * }
 * ```
 */

import { nowMs } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';

interface ApiErrorOptions {
  responseMessage?: string;
  statusCode?: number;
}

/**
 * Handle an API error and convert it into a JSON {@link Response}.
 *
 * @param error - The caught error
 * @param contextTag - Logging context (e.g., "GET /api/profile")
 * @param startTime - Request start time in milliseconds
 * @param options - Optional status code and message overrides
 * @returns Web-standard response with error details and status code
 */
export function handleApiError(
  error: unknown,
  contextTag: string,
  startTime: number,
  options: ApiErrorOptions = {}
): Response {
  const totalTime = nowMs() - startTime;
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';

  logger.error(`Error after ${totalTime}ms:`, errorMessage, contextTag);

  let statusCode = options.statusCode ?? 500;
  const msg = errorMessage.toLowerCase();
  const errorStatus = (error as { status?: number })?.status;
  const hasStatusOverride = options.statusCode !== undefined;

  if (!hasStatusOverride) {
    if (msg.includes('not found')) {
      statusCode = 404;
    } else if (msg.includes('forbidden') || msg.includes('permission') || msg.includes('access denied')) {
      statusCode = 403;
    } else if (msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('bad credentials')) {
      statusCode = 401;
    } else if (msg.includes('validation') || msg.includes('required') || msg.includes('invalid')) {
      statusCode = 400;
    } else if (msg.includes('already exists') || msg.includes('conflict')) {
      statusCode = 409;
    } else if (msg.includes('timeout') || msg.includes('limit')) {
      statusCode = 429;
    }
  }

  if (!hasStatusOverride && statusCode === 500 && errorStatus && errorStatus >= 400 && errorStatus <= 599) {
    statusCode = errorStatus;
  }

  return Response.json(
    {
      success: false as const,
      error: options.responseMessage ?? errorMessage,
      meta: { totalTimeMs: totalTime },
    },
    { status: statusCode }
  );
}
