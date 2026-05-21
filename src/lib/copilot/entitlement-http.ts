/**
 * HTTP mapping for `CopilotEntitlementRequiredError` (P5).
 *
 * Kept out of `src/lib/security/http.ts` (P9) so that the security guard
 * surface stays focused on rate-limit/auth concerns. AI routes import this
 * directly when they want to translate entitlement failures into a 402.
 *
 * Env flag:
 *   COPILOT_REQUIRED=true  (default) → return 402 `copilot_required`.
 *   COPILOT_REQUIRED=false           → reserved for a future GitHub Models
 *                                       REST fallback. Today we still return
 *                                       402 (degraded) but with a clearer
 *                                       message; the actual fallback wiring
 *                                       is intentionally deferred.
 */

import { NextResponse } from 'next/server';

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
 * Returns a `NextResponse` for an entitlement error, or `null` if `error`
 * is unrelated. Callers should check this *before* generic guard mapping
 * so the 402 takes precedence over a 500.
 */
export function copilotEntitlementErrorResponse(error: unknown): NextResponse | null {
  if (!isEntitlementError(error)) return null;

  const copilotRequired = process.env.COPILOT_REQUIRED !== 'false';
  if (!copilotRequired) {
    // TODO: GitHub Models fallback - when COPILOT_REQUIRED=false, route the
    // original request to the GitHub Models REST API instead of returning
    // 402. Today the fallback is not yet wired up; we still surface a 402
    // so the UI can react, but with a message that hints at the future
    // capability.
    return NextResponse.json(
      {
        error: 'copilot_required',
        message:
          'AI features are temporarily unavailable. A Copilot subscription would unlock the full experience.',
        signUpUrl: 'https://github.com/features/copilot',
        fallback: 'github_models_pending',
      },
      { status: 402 },
    );
  }

  return NextResponse.json(
    {
      error: 'copilot_required',
      message: error.message,
      signUpUrl: 'https://github.com/features/copilot',
    },
    { status: 402 },
  );
}
