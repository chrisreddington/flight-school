/**
 * Tests for {@link verifyCronRequest}.
 *
 * Focus is the auth gate's failure modes — JWT verification itself is
 * jose's responsibility and is exercised in those tests. Here we
 * cover the policy layer: env mis-configuration, missing/empty
 * bearer headers, the `CRON_SKIP_AUTH` test-only escape hatch, and
 * the production fail-closed default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CronAuthError, verifyCronRequest } from './cron-auth';

function mkRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.invalid/api/cron/sweep', {
    method: 'POST',
    headers,
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.CRON_SKIP_AUTH;
  delete process.env.CRON_TENANT_ID;
  delete process.env.CRON_AUDIENCE;
  delete process.env.CRON_ALLOWED_APPIDS;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('verifyCronRequest', () => {
  it('honours CRON_SKIP_AUTH=1 when NODE_ENV is non-production (test/dev/Aspire)', async () => {
    process.env.CRON_SKIP_AUTH = '1';
    process.env.NODE_ENV = 'test';

    const payload = await verifyCronRequest(mkRequest());
    expect(payload).toMatchObject({ sub: 'dev-bypass' });
  });

  it('also honours CRON_SKIP_AUTH=1 in NODE_ENV=development (Aspire dashboard)', async () => {
    process.env.CRON_SKIP_AUTH = '1';
    process.env.NODE_ENV = 'development';

    const payload = await verifyCronRequest(mkRequest());
    expect(payload).toMatchObject({ sub: 'dev-bypass' });
  });

  it('rejects CRON_SKIP_AUTH=1 in NODE_ENV=production', async () => {
    process.env.CRON_SKIP_AUTH = '1';
    process.env.NODE_ENV = 'production';

    await expect(verifyCronRequest(mkRequest())).rejects.toBeInstanceOf(CronAuthError);
  });

  it('rejects when env vars are missing', async () => {
    process.env.NODE_ENV = 'production';

    await expect(verifyCronRequest(mkRequest({ authorization: 'Bearer x' }))).rejects.toThrow(
      /misconfigured/i,
    );
  });

  it('rejects when authorization header is missing', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_TENANT_ID = 'tenant';
    process.env.CRON_AUDIENCE = 'api://cron';
    process.env.CRON_ALLOWED_APPIDS = 'app-a';

    await expect(verifyCronRequest(mkRequest())).rejects.toThrow(/bearer/i);
  });

  it('rejects when bearer token is empty', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_TENANT_ID = 'tenant';
    process.env.CRON_AUDIENCE = 'api://cron';
    process.env.CRON_ALLOWED_APPIDS = 'app-a';

    await expect(
      verifyCronRequest(mkRequest({ authorization: 'Bearer ' })),
    ).rejects.toBeInstanceOf(CronAuthError);
  });

  it('wraps jose verification failures as CronAuthError', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CRON_TENANT_ID = 'tenant';
    process.env.CRON_AUDIENCE = 'api://cron';
    process.env.CRON_ALLOWED_APPIDS = 'app-a';

    await expect(
      verifyCronRequest(mkRequest({ authorization: 'Bearer not-a-jwt' })),
    ).rejects.toBeInstanceOf(CronAuthError);
  });
});
