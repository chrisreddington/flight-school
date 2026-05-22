import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { jwtVerifyMock, createRemoteJwkSetMock } = vi.hoisted(() => ({
  jwtVerifyMock: vi.fn(),
  createRemoteJwkSetMock: vi.fn(() => Symbol('jwks')),
}));

vi.mock('jose', () => ({
  jwtVerify: jwtVerifyMock,
  createRemoteJWKSet: createRemoteJwkSetMock,
}));

import { CronAuthError, verifyCronRequest } from './cron-auth';

const ORIGINAL_ENV = { ...process.env };

function makeRequest(token = 'token-123'): Request {
  return new Request('https://example.invalid/api/cron/sweep', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'production',
    CRON_TENANT_ID: 'tenant-123',
    CRON_AUDIENCE: 'api://flight-school-cron',
    CRON_ALLOWED_APPIDS: 'app-a,app-b',
  };
  jwtVerifyMock.mockResolvedValue({ payload: { appid: 'app-a', sub: 'job' } });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe('verifyCronRequest allowlist checks', () => {
  it('accepts tokens when appid is allowlisted', async () => {
    const payload = await verifyCronRequest(makeRequest());

    expect(payload).toMatchObject({ appid: 'app-a', sub: 'job' });
    expect(jwtVerifyMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to azp when appid is absent', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { azp: 'app-b' } });

    const payload = await verifyCronRequest(makeRequest());
    expect(payload).toMatchObject({ azp: 'app-b' });
  });

  it('rejects tokens when appid and azp are not allowlisted', async () => {
    jwtVerifyMock.mockResolvedValue({ payload: { appid: 'unknown-app' } });

    await expect(verifyCronRequest(makeRequest())).rejects.toBeInstanceOf(CronAuthError);
  });

  it('trims allowlist values from env before matching', async () => {
    process.env.CRON_ALLOWED_APPIDS = '  app-z , app-y  ';
    jwtVerifyMock.mockResolvedValue({ payload: { appid: 'app-y' } });

    await expect(verifyCronRequest(makeRequest())).resolves.toMatchObject({ appid: 'app-y' });
  });
});
