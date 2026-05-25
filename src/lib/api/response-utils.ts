/**
 * API Response Utilities
 *
 * Standardized response builders for consistent API responses.
 * All API routes should use these utilities for uniform response format.
 *
 * Returns Web-standard `Response` (not `NextResponse`) so this helper
 * is reachable from both Next.js route handlers and the worker's Hono
 * handlers without pulling `next/server` into the worker import graph.
 * Next routes that consume the result still treat it as a `Response`,
 * which is what they returned to begin with.
 *
 * @module api/response-utils
 */

/**
 * Standard success response format.
 */
interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Standard error response format.
 */
interface ApiErrorResponse {
  success: false;
  error: string;
  meta?: Record<string, unknown>;
}

/**
 * Create a standardized success response.
 *
 * @template T - Type of response data
 * @param data - Response payload
 * @param meta - Optional metadata (timing, etc.)
 * @returns Web-standard response with standardized envelope.
 */
export function apiSuccess<T>(data: T, meta?: Record<string, unknown>): Response {
  const body: ApiSuccessResponse<T> = {
    success: true,
    data,
    ...(meta && { meta }),
  };
  return Response.json(body);
}

/**
 * Create a standardized error response.
 */
function apiError(error: string | Error, meta?: Record<string, unknown>, status = 500): Response {
  const errorMessage = error instanceof Error ? error.message : error;
  const body: ApiErrorResponse = {
    success: false,
    error: errorMessage,
    ...(meta && { meta }),
  };
  return Response.json(body, { status });
}

/**
 * Create a validation error response (400).
 *
 * @param message - Validation error message
 * @param meta - Optional metadata
 * @returns Web-standard response with 400 status.
 */
export function validationErrorResponse(message: string, meta?: Record<string, unknown>): Response {
  return apiError(message, meta, 400);
}
