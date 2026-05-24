import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { InMemoryTokenStore } from './token-store';

/**
 * InMemoryTokenStore is the process-local implementation used in dev and tests.
 * It has no system seams (no fs, no network), so behaviour-only assertions
 * (round-trip through getToken) are the right level here.
 */
describe('InMemoryTokenStore', () => {
  const future = () => Math.floor(Date.now() / 1000) + 3600;

  it('returns null for unknown users', async () => {
    await expect(new InMemoryTokenStore().getToken('nobody')).resolves.toBeNull();
  });

  it('round-trips a token', async () => {
    const store = new InMemoryTokenStore();
    const expiresAt = future();
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt });
    await expect(store.getToken('u1')).resolves.toEqual({ accessToken: 'ghu_x', expiresAt });
  });

  it('returns expired records so callers can refresh via the refresh token', async () => {
    // The caller (resolveFreshGitHubToken) is responsible for checking
    // expiresAt and exchanging the refresh token. Returning null here would
    // make refresh-at-execution impossible.
    const store = new InMemoryTokenStore();
    const stale = { accessToken: 'ghu_old', refreshToken: 'ghr_still_valid', expiresAt: 1 };
    await store.setToken('u1', stale);
    await expect(store.getToken('u1')).resolves.toEqual(stale);
  });

  it('deletes tokens', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: future() });
    await store.deleteToken('u1');
    await expect(store.getToken('u1')).resolves.toBeNull();
  });

  it('cleanupExpired is a no-op until refresh-token expiry is tracked', async () => {
    // We cannot derive refresh-token expiry from the access-token expiresAt,
    // so sweeping by access-token expiry would delete records whose refresh
    // tokens are still valid for months. Cleanup is therefore a no-op; the
    // only deletion path is explicit sign-out (deleteToken).
    const store = new InMemoryTokenStore();
    await store.setToken('a', { accessToken: 'ghu_a', expiresAt: 1 });
    await store.setToken('b', { accessToken: 'ghu_b', expiresAt: future() });
    await expect(store.cleanupExpired()).resolves.toBe(0);
    await expect(store.getToken('a')).resolves.not.toBeNull();
    await expect(store.getToken('b')).resolves.not.toBeNull();
  });

  describe('setTokenIfNewer (CAS semantics)', () => {
    interface CasCase {
      readonly name: string;
      readonly existing: { accessToken: string; expiresAt: number } | null;
      readonly incoming: { accessToken: string; expiresAt: number };
      readonly expectedReturn: boolean;
      readonly expectedFinal: { accessToken: string; expiresAt: number };
    }

    const cases: readonly CasCase[] = [
      {
        name: 'writes when no record exists',
        existing: null,
        incoming: { accessToken: 'ghu_x', expiresAt: 100 },
        expectedReturn: true,
        expectedFinal: { accessToken: 'ghu_x', expiresAt: 100 },
      },
      {
        name: 'writes when incoming.expiresAt is strictly newer',
        existing: { accessToken: 'ghu_old', expiresAt: 50 },
        incoming: { accessToken: 'ghu_new', expiresAt: 100 },
        expectedReturn: true,
        expectedFinal: { accessToken: 'ghu_new', expiresAt: 100 },
      },
      {
        name: 'rejects writes when existing is same age (lost race)',
        existing: { accessToken: 'ghu_first', expiresAt: 100 },
        incoming: { accessToken: 'ghu_second', expiresAt: 100 },
        expectedReturn: false,
        expectedFinal: { accessToken: 'ghu_first', expiresAt: 100 },
      },
      {
        name: 'rejects writes when existing is strictly newer (stale overwrite guard)',
        existing: { accessToken: 'ghu_newer', expiresAt: 100 },
        incoming: { accessToken: 'ghu_older', expiresAt: 50 },
        expectedReturn: false,
        expectedFinal: { accessToken: 'ghu_newer', expiresAt: 100 },
      },
    ];

    it.each(cases)('$name', async ({ existing, incoming, expectedReturn, expectedFinal }) => {
      const store = new InMemoryTokenStore();
      if (existing) await store.setToken('u1', existing);

      await expect(store.setTokenIfNewer('u1', incoming)).resolves.toBe(expectedReturn);
      await expect(store.getToken('u1')).resolves.toEqual(expectedFinal);
    });
  });
});

/**
 * Factory guard: createDefaultTokenStore must pick the right implementation
 * (or refuse to start) based on environment. We exercise the factory through
 * its public output (the constructed instance type / thrown error). Each case
 * re-imports the module with `vi.resetModules()` so env is re-read.
 */
describe('createDefaultTokenStore (factory guard)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  interface FactoryCase {
    readonly name: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly expect:
      | { kind: 'instanceOf'; export: 'InMemoryTokenStore' | 'CosmosTokenStore' }
      | { kind: 'throws'; matches: RegExp };
  }

  const cases: readonly FactoryCase[] = [
    {
      name: 'uses InMemoryTokenStore when Cosmos is not configured and NODE_ENV !== production',
      env: { NODE_ENV: 'development', AZURE_COSMOS_ENDPOINT: undefined },
      expect: { kind: 'instanceOf', export: 'InMemoryTokenStore' },
    },
    {
      name: 'throws in production when AZURE_COSMOS_ENDPOINT is missing',
      env: { NODE_ENV: 'production', AZURE_COSMOS_ENDPOINT: undefined },
      expect: { kind: 'throws', matches: /AZURE_COSMOS_ENDPOINT/ },
    },
    {
      name: 'uses CosmosTokenStore when all Cosmos + Key Vault env vars are set',
      env: {
        NODE_ENV: 'production',
        AZURE_COSMOS_ENDPOINT: 'https://example.documents.azure.com',
        AZURE_COSMOS_DATABASE: 'db',
        AZURE_COSMOS_CONTAINER: 'tokens',
        AZURE_KEY_VAULT_URL: 'https://example.vault.azure.net',
        AZURE_KEY_VAULT_KEY_NAME: 'flight-school-kek',
      },
      expect: { kind: 'instanceOf', export: 'CosmosTokenStore' },
    },
  ];

  it.each(cases)('$name', async ({ env, expect: expected }) => {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
    const mod = await import('./token-store');
    const { createDefaultTokenStore } = mod;

    if (expected.kind === 'throws') {
      expect(() => createDefaultTokenStore()).toThrow(expected.matches);
      return;
    }
    expect(createDefaultTokenStore()).toBeInstanceOf(mod[expected.export]);
  });
});
