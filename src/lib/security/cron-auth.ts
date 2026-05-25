/**
 * Entra ID JWT verification for the `/api/cron/sweep` route.
 *
 * The cron endpoint is destructive (it iterates every user directory
 * and runs retention sweepers across all of them), so its inbound auth
 * must be tight:
 *
 *   - Verified against Microsoft's published JWKS via {@link createRemoteJWKSet}
 *     so we never carry a static shared secret.
 *   - `iss` checked against the configured Entra tenant.
 *   - `aud` checked against the dedicated cron audience.
 *   - `appid` / `azp` checked against an allowlist (the ACA Job's
 *     managed-identity client id).
 *   - `exp` / `nbf` enforced by `jose.jwtVerify`.
 *
 * Env vars (set in production via the ACA env):
 *   - `CRON_TENANT_ID`       Entra tenant GUID. Required.
 *   - `CRON_AUDIENCE`        Expected `aud` claim. Required.
 *   - `CRON_ALLOWED_APPIDS`  Comma-separated allowlist of caller appids.
 *
 * In tests only (`NODE_ENV === 'test'`), `CRON_SKIP_AUTH=1` bypasses
 * verification entirely. The check below fails closed in every other
 * environment, including production with `NODE_ENV` accidentally unset.
 *
 * @module security/cron-auth
 */

import 'server-only';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { logger } from '@/lib/logger';

const log = logger.withTag('CronAuth');

class CronAuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'CronAuthError';
  }
}

interface CachedJwks {
  tenantId: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

let cached: CachedJwks | null = null;

function getJwks(tenantId: string): ReturnType<typeof createRemoteJWKSet> {
  if (cached && cached.tenantId === tenantId) return cached.jwks;
  const jwksUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`);
  const jwks = createRemoteJWKSet(jwksUrl);
  cached = { tenantId, jwks };
  return jwks;
}

function isNonProdEnv(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Verify the incoming request is a valid Entra-issued bearer token
 * from an allowlisted caller. Throws {@link CronAuthError} on any
 * verification failure; the route handler is expected to turn that
 * into a 401 response.
 *
 * Returns the verified token payload so the route handler can include
 * the caller's `appid` in audit logs.
 */
export async function verifyCronRequest(request: Request): Promise<JWTPayload> {
  if (process.env.CRON_SKIP_AUTH === '1') {
    if (!isNonProdEnv()) {
      // Fail closed: a stray `CRON_SKIP_AUTH=1` in production must not
      // turn this destructive endpoint into an open relay. Only honoured
      // in non-production environments (tests, local Aspire dev, etc.).
      log.error('CRON_SKIP_AUTH set in production — refusing');
      throw new CronAuthError('Cron auth bypass not permitted in this environment');
    }
    return { sub: 'dev-bypass' };
  }

  const tenantId = process.env.CRON_TENANT_ID;
  const audience = process.env.CRON_AUDIENCE;
  const allowedAppids = (process.env.CRON_ALLOWED_APPIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!tenantId || !audience || allowedAppids.length === 0) {
    log.error('Cron auth misconfigured', {
      hasTenant: Boolean(tenantId),
      hasAudience: Boolean(audience),
      appidCount: allowedAppids.length,
    });
    throw new CronAuthError('Cron auth misconfigured');
  }

  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) {
    throw new CronAuthError('Missing bearer token');
  }
  const token = header.slice(7).trim();
  if (!token) throw new CronAuthError('Empty bearer token');

  const expectedIssuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
  ];

  try {
    const { payload } = await jwtVerify(token, getJwks(tenantId), {
      audience,
      issuer: expectedIssuers,
    });
    const appid =
      (typeof payload.appid === 'string' && payload.appid) || (typeof payload.azp === 'string' && payload.azp) || '';
    if (!appid || !allowedAppids.includes(appid)) {
      throw new CronAuthError('Caller appid not in allowlist');
    }
    return payload;
  } catch (err) {
    if (err instanceof CronAuthError) throw err;
    throw new CronAuthError(`JWT verification failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

export { CronAuthError };
