/**
 * HTTP mapping for `CopilotEntitlementRequiredError` (P5).
 *
 * Kept out of `src/lib/security/http.ts` (P9) so that the security guard
 * surface stays focused on rate-limit/auth concerns. AI routes import this
 * directly when they want to translate entitlement failures into a 402.
 *
 * Returns a Web-standard `Response` (not `NextResponse`) so this helper
 * stays reachable from both Next.js route handlers and the worker's Hono
 * handlers.
 *
 * The Copilot SDK is the only AI route. Users without a Copilot
 * entitlement always receive a 402 `copilot_required`; the legacy
 * GitHub Models REST fallback has been removed (H2).
 */

import {
  COPILOT_ENTITLEMENT_ERROR_NAME,
  CopilotEntitlementRequiredError,
} from '@/lib/copilot/entitlement';

/** Detect either the typed error or anything carrying the stable name. */
function isEntitlementError(error: unknown): error is CopilotEntitlementRequiredError {
  if (error instanceof CopilotEntitlementRequiredError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === COPILOT_ENTITLEMENT_ERROR_NAME
  );
}

/**
 * Returns a `Response` for an entitlement error, or `null` if `error`
 * is unrelated. Callers should check this *before* generic guard mapping
 * so the 402 takes precedence over a 500.
 */
export function copilotEntitlementErrorResponse(error: unknown): Response | null {
  if (!isEntitlementError(error)) return null;

  return Response.json(
    {
      error: 'copilot_required',
      message: error.message,
      signUpUrl: 'https://github.com/features/copilot',
    },
    { status: 402 },
  );
}
