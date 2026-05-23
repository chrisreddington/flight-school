/**
 * Copilot Entitlement Detection & Caching (P5)
 *
 * Most GitHub users do not have a Copilot subscription. When such a user signs
 * in and we forward their token to `CopilotClient.createSession({ gitHubToken })`,
 * the CLI server rejects the request with an entitlement/auth error.
 *
 * The SDK does **not** export a dedicated error class for this case. The
 * `session.create` call is dispatched over JSON-RPC via `vscode-jsonrpc`, so
 * failures surface either as:
 *   - `ResponseError` from `vscode-jsonrpc` (has `code: number` + `message`)
 *   - a plain `Error` whose `message` was forwarded from the server
 *
 * We therefore detect entitlement failures by:
 *   1. Matching well-known phrases the server uses ("not entitled to",
 *      "copilot subscription", "no active subscription", "forbidden",
 *      "unauthorized", "401"/"403" embedded in the message).
 *   2. Treating JSON-RPC ResponseError codes -32001/-32002 (custom server
 *      auth codes) and HTTP-shaped 401/403/402 status hints in the message
 *      as entitlement signals.
 *
 * Because this is fuzzy, we err on the side of false positives: if the
 * underlying problem is some other 4xx and we surface a "Copilot required"
 * banner, the user still gets a sensible message + a path forward. We do
 * **not** treat 5xx/network errors as entitlement failures.
 *
 * Per-user sticky-negative cache: once a user has been observed to lack a
 * Copilot license, we suppress further SDK calls for `NEGATIVE_TTL_MS`
 * (5 minutes). This avoids hammering the SDK every request for a user
 * already known to be unentitled.
 */

/** Stable error name used by the HTTP layer to map to 402. */
export const COPILOT_ENTITLEMENT_ERROR_NAME = 'CopilotEntitlementRequiredError';

/** How long (ms) we remember that a given user has no Copilot license. */
export const NEGATIVE_TTL_MS = 5 * 60 * 1000;

/**
 * Thrown when a user attempts an AI operation without a Copilot license.
 * Mapped to HTTP 402 by `src/lib/copilot/entitlement-http.ts`.
 */
export class CopilotEntitlementRequiredError extends Error {
  override readonly name = COPILOT_ENTITLEMENT_ERROR_NAME;
  readonly code = 'copilot_required';
  readonly signUpUrl = 'https://github.com/features/copilot';

  constructor(
    message = 'A GitHub Copilot subscription is required to use AI features.',
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

/**
 * Message fragments (lower-cased) the CLI / Copilot backends are known to
 * use when a token lacks Copilot entitlement. Keep this list narrow — we
 * want to avoid false positives on unrelated 4xx errors.
 */
const ENTITLEMENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /not\s+entitled/i,
  /no\s+(active\s+)?copilot\s+subscription/i,
  /copilot\s+(subscription|license|access)\s+(is\s+)?required/i,
  /copilot\s+(is\s+)?not\s+(enabled|available)/i,
  /user\s+is\s+not\s+a\s+copilot\s+user/i,
  /requires?\s+a\s+copilot\s+subscription/i,
  /\bcopilot[_-]?required\b/i,
  /\b(403|401)\b.*\bcopilot\b/i,
  /\bcopilot\b.*\b(403|401|forbidden|unauthorized)\b/i,
];

/**
 * Best-effort detection of "this token has no Copilot license" errors thrown
 * by `CopilotClient.createSession`.
 *
 * @returns true when the error looks like an entitlement failure.
 */
export function isCopilotEntitlementError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (err instanceof CopilotEntitlementRequiredError) return true;

  // ResponseError-style shape from vscode-jsonrpc: { code: number, message: string }
  const candidate = err as { code?: unknown; message?: unknown; data?: unknown };
  const message =
    typeof candidate.message === 'string'
      ? candidate.message
      : err instanceof Error
        ? err.message
        : '';

  if (!message) return false;

  // Known custom server-side auth codes used by Copilot CLI's JSON-RPC server.
  // -32001 / -32002 are conventional auth/forbidden buckets in the
  // server-defined error range; we only treat them as entitlement when the
  // accompanying message references Copilot or auth.
  if (typeof candidate.code === 'number') {
    if (
      (candidate.code === -32001 || candidate.code === -32002) &&
      /copilot|auth|forbid|entitl/i.test(message)
    ) {
      return true;
    }
  }

  for (const pattern of ENTITLEMENT_MESSAGE_PATTERNS) {
    if (pattern.test(message)) return true;
  }
  return false;
}

// =============================================================================
// Sticky-negative cache (per userId)
// =============================================================================

interface NegativeCacheEntry {
  /** Epoch ms when this entry expires. */
  expiresAt: number;
}

// Keep cache in globalThis so it survives Next.js HMR in dev.
const globalForEntitlementCache = globalThis as typeof globalThis & {
  __copilotEntitlementNegativeCache?: Map<string, NegativeCacheEntry>;
};

const negativeCache =
  globalForEntitlementCache.__copilotEntitlementNegativeCache ??
  new Map<string, NegativeCacheEntry>();

if (!globalForEntitlementCache.__copilotEntitlementNegativeCache) {
  globalForEntitlementCache.__copilotEntitlementNegativeCache = negativeCache;
}

/**
 * Returns true if we have a fresh "user has no Copilot" verdict cached.
 * Expired entries are removed lazily on access.
 */
export function hasNegativeEntitlement(userId: string, now: number = Date.now()): boolean {
  const entry = negativeCache.get(userId);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    negativeCache.delete(userId);
    return false;
  }
  return true;
}

/**
 * Remember that `userId` has no Copilot license. Subsequent calls within
 * `NEGATIVE_TTL_MS` (default 5 minutes) will short-circuit without hitting
 * the SDK.
 */
export function markNegativeEntitlement(userId: string, now: number = Date.now()): void {
  negativeCache.set(userId, { expiresAt: now + NEGATIVE_TTL_MS });
}

/**
 * Clear a cached negative verdict. Exposed for tests and for future
 * "re-check after upgrade" flows.
 */
export function clearNegativeEntitlement(userId?: string): void {
  if (userId === undefined) {
    negativeCache.clear();
    return;
  }
  negativeCache.delete(userId);
}
