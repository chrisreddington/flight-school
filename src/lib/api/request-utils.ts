/**
 * API Request Utilities
 *
 * Safe request body parsing with typed results.
 * Eliminates boilerplate try-catch blocks in API routes.
 *
 * Uses Web-standard `Request` (not `NextRequest`) so this helper is
 * reachable from both Next.js route handlers and the worker's Hono
 * handlers without pulling `next/server` into the worker import graph.
 *
 * @module api/request-utils
 */

/**
 * Result of successful JSON body parsing.
 */
interface ParseSuccess<T> {
  success: true;
  data: T;
}

/**
 * Result of failed JSON body parsing.
 */
interface ParseError {
  success: false;
  error: string;
}

/**
 * Union type for parse results.
 */
type ParseResult<T> = ParseSuccess<T> | ParseError;

/**
 * Safely parse JSON body from a request.
 *
 * @template T - Expected type of parsed body
 * @param request - Web-standard request object
 * @returns Parse result with discriminated union (success/error)
 *
 * @example
 * ```typescript
 * const result = await parseJsonBody<MyType>(request);
 * if (!result.success) {
 *   return Response.json({ error: result.error }, { status: 400 });
 * }
 * const { data } = result; // typed as MyType
 * ```
 */
export async function parseJsonBody<T = unknown>(request: Request): Promise<ParseResult<T>> {
  try {
    const data = await request.json();
    return { success: true, data: data as T };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Invalid JSON in request body';
    return { success: false, error: errorMessage };
  }
}

/**
 * Parse JSON body with a fallback value on error.
 *
 * @template T - Expected type of parsed body
 * @param request - Web-standard request object
 * @param fallback - Value to return on parse error
 * @returns Parsed data or fallback
 */
export async function parseJsonBodyWithFallback<T>(request: Request, fallback: T): Promise<T> {
  try {
    const data = await request.json();
    return data as T;
  } catch {
    return fallback;
  }
}
