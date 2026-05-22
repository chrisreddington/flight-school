import { UnauthorizedError } from '@/lib/auth/context';
import { copilotEntitlementErrorResponse } from '@/lib/copilot/entitlement-http';
import { NextResponse } from 'next/server';

/** Convert an Auth.js user-context failure into the standard API 401 response. */
function unauthorizedResponse(error: UnauthorizedError): NextResponse {
  return NextResponse.json({ error: error.message }, { status: 401 });
}

/** Return a standard API 401 response when `error` is an auth failure. */
export function authErrorResponse(error: unknown): NextResponse | null {
  return error instanceof UnauthorizedError ? unauthorizedResponse(error) : null;
}

/** Return a response for known auth-adjacent API errors, or null for unrelated errors. */
export function knownApiErrorResponse(error: unknown): NextResponse | null {
  return copilotEntitlementErrorResponse(error) ?? authErrorResponse(error);
}

/** Return a 401 response for auth failures; rethrow non-auth errors unchanged. */
export function handleUnauthorizedError(error: unknown): NextResponse {
  const response = authErrorResponse(error);
  if (response) return response;
  throw error;
}
