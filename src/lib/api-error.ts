/**
 * API Error Handler
 *
 * Centralizes error handling logic for API routes.
 * Maps error messages to appropriate HTTP status codes and invalidates
 * cached tokens for authentication errors.
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

import { invalidateTokenCache } from '@/lib/github/client';
import { nowMs } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';
import { NextResponse } from 'next/server';

interface ApiErrorOptions {
  responseMessage?: string;
  statusCode?: number;
}

/**
 * Handles API errors with appropriate status codes and token invalidation.
 *
 * @param error - The caught error
 * @param contextTag - Logging context (e.g., "GET /api/profile")
 * @param startTime - Request start time in milliseconds
 * @param options - Optional status code and message overrides
 * @returns NextResponse with error details and status code
 */
export function handleApiError(
  error: unknown,
  contextTag: string,
  startTime: number,
  options: ApiErrorOptions = {}
) {
  const totalTime = nowMs() - startTime;
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  
  // Log the error using the centralized logger
  logger.error(`Error after ${totalTime}ms:`, errorMessage, contextTag);

  // Determine appropriate status code based on error message patterns
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

  const authStatusCodes = new Set([401, 403]);
  const shouldInvalidateToken =
    authStatusCodes.has(statusCode) ||
    (errorStatus ? authStatusCodes.has(errorStatus) : false) ||
    msg.includes('unauthorized') ||
    msg.includes('authentication') ||
    msg.includes('bad credentials');

  if (shouldInvalidateToken) {
    logger.warn('Invalidating token cache due to authentication error', contextTag);
    invalidateTokenCache();
  }

  return NextResponse.json(
    {
      success: false as const,
      error: options.responseMessage ?? errorMessage,
      meta: { totalTimeMs: totalTime },
    },
    { status: statusCode }
  );
}
