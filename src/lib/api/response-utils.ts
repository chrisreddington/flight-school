/**
 * API Response Utilities
 * 
 * Standardized response builders for consistent API responses.
 * All API routes should use these utilities for uniform response format.
 * 
 * @module api/response-utils
 */

import { NextResponse } from 'next/server';

/**
 * Standard success response format.
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/**
 * Standard error response format.
 */
export interface ApiErrorResponse {
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
 * @returns Next.js response with standardized format
 */
export function apiSuccess<T>(
  data: T,
  meta?: Record<string, unknown>
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    success: true,
    data,
    ...(meta && { meta }),
  });
}

/**
 * Create a standardized error response.
 * 
 * @param error - Error message or Error object
 * @param meta - Optional metadata (timing, etc.)
 * @param status - HTTP status code (default: 500)
 * @returns Next.js response with standardized format
 */
function apiError(
  error: string | Error,
  meta?: Record<string, unknown>,
  status = 500
): NextResponse<ApiErrorResponse> {
  const errorMessage = error instanceof Error ? error.message : error;
  
  return NextResponse.json(
    {
      success: false,
      error: errorMessage,
      ...(meta && { meta }),
    },
    { status }
  );
}

/**
 * Create a validation error response (400).
 * 
 * @param message - Validation error message
 * @param meta - Optional metadata
 * @returns Next.js response with 400 status
 * 
 * @example
 * ```typescript
 * if (validationError) {
 *   return validationErrorResponse(validationError, { totalTimeMs });
 * }
 * ```
 */
export function validationErrorResponse(
  message: string,
  meta?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return apiError(message, meta, 400);
}

/**
 * Create a service unavailable error response (503).
 * 
 * @param message - Error message
 * @param meta - Optional metadata
 * @returns Next.js response with 503 status
 * 
 * @example
 * ```typescript
 * if (!(await isGitHubConfigured())) {
 *   return serviceUnavailableResponse('GitHub API not configured');
 * }
 * ```
 */
export function serviceUnavailableResponse(
  message: string,
  meta?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return apiError(message, meta, 503);
}
