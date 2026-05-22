import { createCipheriv, randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock state. `vi.mock` factories run before module-level `let`s, so
// we lift everything into a `vi.hoisted` block that the factories can read.
const mocks = vi.hoisted(() => {
  return {
    wrapKey: vi.fn(),
    unwrapKey: vi.fn(),
    containerItemRead: vi.fn(),
    containerItemDelete: vi.fn(),
    containerItemReplace: vi.fn(),
    containerItemsUpsert: vi.fn(),
    containerItemsCreate: vi.fn(),
    containerItemsQueryFetch: vi.fn(),
    containerItemsQueryHasMore: vi.fn(),
  };
});

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(function () {
    return { kind: 'mock-credential' };
  }),
}));

vi.mock('@azure/keyvault-keys', () => ({
  CryptographyClient: vi.fn(function () {
    return {
      wrapKey: mocks.wrapKey,
      unwrapKey: mocks.unwrapKey,
    };
  }),
  KnownEncryptionAlgorithms: { A256KW: 'A256KW' },
}));

vi.mock('@azure/cosmos', () => {
  const CosmosClient = vi.fn(function () {
    return {
      database: () => ({
        container: () => buildMockContainer(),
      }),
    };
  });
  return { CosmosClient };
});

interface ItemRef {
  read: typeof mocks.containerItemRead;
  delete: typeof mocks.containerItemDelete;
  replace: typeof mocks.containerItemReplace;
}

function buildMockContainer() {
  return {
    item: (): ItemRef => ({
      read: mocks.containerItemRead,
      delete: mocks.containerItemDelete,
      replace: mocks.containerItemReplace,
    }),
    items: {
      upsert: mocks.containerItemsUpsert,
      create: mocks.containerItemsCreate,
      query: () => ({
        hasMoreResults: mocks.containerItemsQueryHasMore,
        fetchNext: mocks.containerItemsQueryFetch,
      }),
    },
  };
}

import { CosmosTokenStore, InMemoryTokenStore } from './token-store';

describe('InMemoryTokenStore', () => {
  it('returns null for unknown users', async () => {
    const store = new InMemoryTokenStore();
    await expect(store.getToken('nobody')).resolves.toBeNull();
  });

  it('round-trips a token', async () => {
    const store = new InMemoryTokenStore();
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: future });
    await expect(store.getToken('u1')).resolves.toEqual({
      accessToken: 'ghu_x',
      expiresAt: future,
    });
  });

  it('returns expired records so callers can refresh via the refresh token', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', {
      accessToken: 'ghu_old',
      refreshToken: 'ghr_still_valid',
      expiresAt: 1,
    });
    // getToken returns the record even when the access token is expired.
    // The caller (e.g. resolveFreshGitHubToken) is responsible for checking
    // expiresAt and exchanging the refresh token. Returning null here would
    // make refresh-at-execution impossible.
    await expect(store.getToken('u1')).resolves.toEqual({
      accessToken: 'ghu_old',
      refreshToken: 'ghr_still_valid',
      expiresAt: 1,
    });
  });

  it('deletes tokens', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', {
      accessToken: 'ghu_x',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    await store.deleteToken('u1');
    await expect(store.getToken('u1')).resolves.toBeNull();
  });

  it('cleanupExpired is a no-op until refresh-token expiry is tracked', async () => {
    // We cannot derive refresh-token expiry from the access-token expiresAt,
    // so sweeping by access-token expiry would delete records whose refresh
    // tokens are still valid for months. Until we plumb refresh-token expiry
    // through the OAuth callback, cleanup is a no-op and the only deletion
    // path is explicit sign-out (deleteToken). Records are bounded per user
    // (one row per user), so unbounded growth scales with user count, not
    // request count — acceptable for now. Tracked as follow-up.
    const store = new InMemoryTokenStore();
    const past = 1;
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.setToken('a', { accessToken: 'ghu_a', expiresAt: past });
    await store.setToken('b', { accessToken: 'ghu_b', expiresAt: future });
    const removed = await store.cleanupExpired();
    expect(removed).toBe(0);
    // Both records still readable.
    await expect(store.getToken('a')).resolves.not.toBeNull();
    await expect(store.getToken('b')).resolves.not.toBeNull();
  });

  describe('setTokenIfNewer', () => {
    it('writes when no record exists', async () => {
      const store = new InMemoryTokenStore();
      const fresh = { accessToken: 'ghu_x', expiresAt: 100 };
      await expect(store.setTokenIfNewer('u1', fresh)).resolves.toBe(true);
      await expect(store.getToken('u1')).resolves.toEqual(fresh);
    });

    it('writes when incoming.expiresAt is strictly newer than existing', async () => {
      const store = new InMemoryTokenStore();
      await store.setToken('u1', { accessToken: 'ghu_old', expiresAt: 50 });
      const newer = { accessToken: 'ghu_new', expiresAt: 100 };
      await expect(store.setTokenIfNewer('u1', newer)).resolves.toBe(true);
      await expect(store.getToken('u1')).resolves.toEqual(newer);
    });

    it('rejects writes when existing record is the same age (lost race)', async () => {
      const store = new InMemoryTokenStore();
      await store.setToken('u1', { accessToken: 'ghu_first', expiresAt: 100 });
      const competing = { accessToken: 'ghu_second', expiresAt: 100 };
      await expect(store.setTokenIfNewer('u1', competing)).resolves.toBe(false);
      await expect(store.getToken('u1')).resolves.toEqual({
        accessToken: 'ghu_first',
        expiresAt: 100,
      });
    });

    it('rejects writes when existing record is strictly newer (stale overwrite guard)', async () => {
      const store = new InMemoryTokenStore();
      await store.setToken('u1', { accessToken: 'ghu_newer', expiresAt: 100 });
      const older = { accessToken: 'ghu_older', expiresAt: 50 };
      await expect(store.setTokenIfNewer('u1', older)).resolves.toBe(false);
      await expect(store.getToken('u1')).resolves.toEqual({
        accessToken: 'ghu_newer',
        expiresAt: 100,
      });
    });
  });
});

describe('CosmosTokenStore', () => {
  const FAKE_DEK = randomBytes(32);
  const baseConfig = {
    cosmosEndpoint: 'https://example.documents.azure.com',
    databaseId: 'db',
    containerId: 'tokens',
    keyVaultUrl: 'https://example.vault.azure.net',
    keyName: 'flight-school-kek',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // wrapKey returns an opaque blob; unwrapKey returns our fake DEK.
    mocks.wrapKey.mockResolvedValue({ result: new Uint8Array([0xaa, 0xbb, 0xcc]) });
    mocks.unwrapKey.mockResolvedValue({ result: FAKE_DEK });
    mocks.containerItemsUpsert.mockResolvedValue({ resource: {} });
    mocks.containerItemDelete.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('set: encrypts payload, wraps DEK with A256KW, persists ciphertext (not plaintext)', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const token = { accessToken: 'ghu_supersecret', refreshToken: 'ghr_refresh', expiresAt: 9999999999 };

    await store.setToken('user-42', token);

    expect(mocks.wrapKey).toHaveBeenCalledTimes(1);
    const [wrapAlg, wrapDek] = mocks.wrapKey.mock.calls[0];
    expect(wrapAlg).toBe('A256KW');
    expect((wrapDek as Uint8Array).length).toBe(32);

    expect(mocks.containerItemsUpsert).toHaveBeenCalledTimes(1);
    const [doc] = mocks.containerItemsUpsert.mock.calls[0];
    expect(doc.userId).toBe('user-42');
    expect(doc.alg).toBe('AES-256-GCM/A256KW');
    expect(doc.kekId).toContain('flight-school-kek');
    // IV is the GCM standard 12 bytes (base64 encoded).
    expect(Buffer.from(doc.iv, 'base64').length).toBe(12);
    expect(Buffer.from(doc.authTag, 'base64').length).toBe(16);
    // Ciphertext must NOT contain the plaintext token value.
    const ctRaw = Buffer.from(doc.ciphertext, 'base64').toString('binary');
    expect(ctRaw).not.toContain('ghu_supersecret');
    expect(ctRaw).not.toContain('ghr_refresh');
    expect(JSON.stringify(doc)).not.toContain('ghu_supersecret');
  });

  it('get: unwraps DEK and decrypts AES-GCM ciphertext', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const token = { accessToken: 'ghu_roundtrip', expiresAt: 9999999999 };
    const doc = encryptForTest(token, FAKE_DEK, 'user-42');
    mocks.containerItemRead.mockResolvedValue({ resource: doc });

    const result = await store.getToken('user-42');

    expect(mocks.unwrapKey).toHaveBeenCalledWith('A256KW', expect.any(Buffer));
    expect(result).toEqual(token);
  });

  it('get: throws when the auth tag is tampered (AEAD detects mutation)', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const token = { accessToken: 'ghu_tampered', expiresAt: 9999999999 };
    const doc = encryptForTest(token, FAKE_DEK, 'user-42');
    // Flip a bit in the auth tag.
    const tag = Buffer.from(doc.authTag, 'base64');
    tag[0] ^= 0x01;
    doc.authTag = tag.toString('base64');
    mocks.containerItemRead.mockResolvedValue({ resource: doc });

    await expect(store.getToken('user-42')).rejects.toThrow();
  });

  it('get: returns null when the stored document is for a different userId', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const otherDoc = encryptForTest({ accessToken: 'ghu_other', expiresAt: 9999999999 }, FAKE_DEK, 'attacker');
    mocks.containerItemRead.mockResolvedValue({ resource: otherDoc });

    const result = await store.getToken('victim');
    expect(result).toBeNull();
    // Critical: we never reached decryption / unwrap.
    expect(mocks.unwrapKey).not.toHaveBeenCalled();
  });

  it('get: throws on cross-user replay (envelope copied into a different userId document)', async () => {
    const store = new CosmosTokenStore(baseConfig);
    // Attacker writes a document whose userId field matches the victim, but
    // whose ciphertext + iv + authTag were produced with AAD bound to a
    // different (attacker) userId. AAD mismatch must fail decryption.
    const envelope = encryptForTest(
      { accessToken: 'ghu_attacker', expiresAt: 9999999999 },
      FAKE_DEK,
      'attacker',
    );
    const replayed = { ...envelope, id: 'victim', userId: 'victim' };
    mocks.containerItemRead.mockResolvedValue({ resource: replayed });

    await expect(store.getToken('victim')).rejects.toThrow();
  });

  it('get: throws when expiresAt on the document is tampered (AAD mismatch)', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const doc = encryptForTest(
      { accessToken: 'ghu_x', expiresAt: 9999999999 },
      FAKE_DEK,
      'user-42',
    );
    // Push expiry further out without re-encrypting. AAD includes expiresAt,
    // so this must trip AES-GCM's authTag check at decipher.final().
    doc.expiresAt = doc.expiresAt + 1;
    mocks.containerItemRead.mockResolvedValue({ resource: doc });

    await expect(store.getToken('user-42')).rejects.toThrow();
  });

  it('get: throws when kekId on the document is tampered (AAD mismatch)', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const doc = encryptForTest(
      { accessToken: 'ghu_x', expiresAt: 9999999999 },
      FAKE_DEK,
      'user-42',
    );
    doc.kekId = 'https://example.vault.azure.net/keys/some-other-key';
    mocks.containerItemRead.mockResolvedValue({ resource: doc });

    await expect(store.getToken('user-42')).rejects.toThrow();
  });

  it('get: returns null on 404 from Cosmos', async () => {
    const store = new CosmosTokenStore(baseConfig);
    mocks.containerItemRead.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
    await expect(store.getToken('nobody')).resolves.toBeNull();
  });

  it('get: returns expired records so callers can refresh', async () => {
    // Cosmos store must mirror InMemoryTokenStore: do not hide refreshable
    // records behind a null. The resolver decides whether to refresh.
    const store = new CosmosTokenStore(baseConfig);
    const token = { accessToken: 'ghu_old', refreshToken: 'ghr_valid', expiresAt: 1 };
    const doc = encryptForTest(token, FAKE_DEK, 'user-42');
    mocks.containerItemRead.mockResolvedValue({ resource: doc });
    await expect(store.getToken('user-42')).resolves.toEqual(token);
  });

  it('delete: removes the Cosmos document', async () => {
    const store = new CosmosTokenStore(baseConfig);
    await store.deleteToken('user-42');
    expect(mocks.containerItemDelete).toHaveBeenCalledTimes(1);
  });

  it('delete: tolerates 404', async () => {
    const store = new CosmosTokenStore(baseConfig);
    mocks.containerItemDelete.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 404 }));
    await expect(store.deleteToken('user-42')).resolves.toBeUndefined();
  });

  it('cleanupExpired: is a no-op until refresh-token expiry is tracked', async () => {
    // See the InMemoryTokenStore equivalent test for the rationale. Cosmos
    // mirrors the same behaviour: never delete a record based on access-token
    // expiry alone, because the refresh token is likely still valid.
    const store = new CosmosTokenStore(baseConfig);
    const removed = await store.cleanupExpired();
    expect(removed).toBe(0);
    expect(mocks.containerItemDelete).not.toHaveBeenCalled();
  });

  describe('setTokenIfNewer', () => {
    it('create-path: 404 on read → uses items.create (not upsert) and returns true', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 404 }),
      );
      mocks.containerItemsCreate.mockResolvedValue({ resource: {} });

      const result = await store.setTokenIfNewer('user-42', {
        accessToken: 'ghu_first',
        expiresAt: 9999999999,
      });

      expect(result).toBe(true);
      expect(mocks.containerItemsCreate).toHaveBeenCalledTimes(1);
      expect(mocks.containerItemReplace).not.toHaveBeenCalled();
      expect(mocks.containerItemsUpsert).not.toHaveBeenCalled();
    });

    it('replace-path: existing older → replace with If-Match etag and returns true', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockResolvedValue({
        resource: { id: 'user-42', userId: 'user-42', expiresAt: 100 } as Partial<unknown>,
        etag: 'etag-abc',
      });
      mocks.containerItemReplace.mockResolvedValue({ resource: {} });

      const result = await store.setTokenIfNewer('user-42', {
        accessToken: 'ghu_new',
        expiresAt: 200,
      });

      expect(result).toBe(true);
      expect(mocks.containerItemReplace).toHaveBeenCalledTimes(1);
      const [, replaceOpts] = mocks.containerItemReplace.mock.calls[0];
      expect(replaceOpts).toEqual({
        accessCondition: { type: 'IfMatch', condition: 'etag-abc' },
      });
    });

    it('skip-path: existing newer → returns false without encrypting or writing', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockResolvedValue({
        resource: { id: 'user-42', userId: 'user-42', expiresAt: 200 } as Partial<unknown>,
        etag: 'etag-newer',
      });

      const result = await store.setTokenIfNewer('user-42', {
        accessToken: 'ghu_older',
        expiresAt: 100,
      });

      expect(result).toBe(false);
      // Critical: we never paid the cost of encryption / KV wrapKey for a
      // write we knew up-front would lose.
      expect(mocks.wrapKey).not.toHaveBeenCalled();
      expect(mocks.containerItemReplace).not.toHaveBeenCalled();
      expect(mocks.containerItemsCreate).not.toHaveBeenCalled();
    });

    it('skip-path: existing same-age → returns false (no clobber on tie)', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockResolvedValue({
        resource: { id: 'user-42', userId: 'user-42', expiresAt: 100 } as Partial<unknown>,
        etag: 'etag-tie',
      });

      await expect(
        store.setTokenIfNewer('user-42', { accessToken: 'ghu_same', expiresAt: 100 }),
      ).resolves.toBe(false);
    });

    it('race: 412 PreconditionFailed on replace → returns false', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockResolvedValue({
        resource: { id: 'user-42', userId: 'user-42', expiresAt: 100 } as Partial<unknown>,
        etag: 'etag-stale',
      });
      mocks.containerItemReplace.mockRejectedValue(
        Object.assign(new Error('precondition failed'), { code: 412 }),
      );

      await expect(
        store.setTokenIfNewer('user-42', { accessToken: 'ghu_new', expiresAt: 200 }),
      ).resolves.toBe(false);
    });

    it('race: 409 Conflict on create → returns false', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 404 }),
      );
      mocks.containerItemsCreate.mockRejectedValue(
        Object.assign(new Error('conflict'), { code: 409 }),
      );

      await expect(
        store.setTokenIfNewer('user-42', { accessToken: 'ghu_x', expiresAt: 100 }),
      ).resolves.toBe(false);
    });

    it('propagates non-precondition Cosmos errors', async () => {
      const store = new CosmosTokenStore(baseConfig);
      mocks.containerItemRead.mockRejectedValue(
        Object.assign(new Error('boom'), { code: 500 }),
      );

      await expect(
        store.setTokenIfNewer('user-42', { accessToken: 'ghu_x', expiresAt: 100 }),
      ).rejects.toThrow('boom');
    });
  });

  describe('DEK cache', () => {
    it('skips Key Vault unwrapKey on a second read of the same envelope', async () => {
      const store = new CosmosTokenStore(baseConfig);
      const token = { accessToken: 'ghu_cached', expiresAt: 9999999999 };
      const doc = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      await store.getToken('user-42');

      // First read unwraps; second read MUST hit the cache.
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(1);
    });

    it('re-unwraps when the envelope changes (record rewritten with a new DEK)', async () => {
      const store = new CosmosTokenStore(baseConfig);
      const token = { accessToken: 'ghu_one', expiresAt: 9999999999 };
      const docV1 = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValueOnce({ resource: docV1 });
      await store.getToken('user-42');

      // Simulate a rotation: a fresh DEK + a different wrappedDek on the doc.
      const NEW_DEK = randomBytes(32);
      const docV2 = encryptForTest(token, NEW_DEK, 'user-42');
      // Mutate wrappedDek so the envelope digest differs.
      docV2.wrappedDek = Buffer.from('different-wrapped-blob').toString('base64');
      mocks.containerItemRead.mockResolvedValueOnce({ resource: docV2 });
      mocks.unwrapKey.mockResolvedValueOnce({ result: NEW_DEK });

      await store.getToken('user-42');

      // First read unwrapped, second read also unwrapped because envelope changed.
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache on setToken so a subsequent read re-unwraps', async () => {
      const store = new CosmosTokenStore(baseConfig);
      const token = { accessToken: 'ghu_first', expiresAt: 9999999999 };
      const doc = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(1);

      // setToken for the same user should drop the cached DEK.
      await store.setToken('user-42', { accessToken: 'ghu_second', expiresAt: 9999999999 });

      await store.getToken('user-42');
      // Cache invalidated → second read unwraps again.
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache on deleteToken', async () => {
      const store = new CosmosTokenStore(baseConfig);
      const token = { accessToken: 'ghu_d', expiresAt: 9999999999 };
      const doc = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      await store.deleteToken('user-42');
      await store.getToken('user-42');

      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('invalidates the cache on a successful setTokenIfNewer CAS write', async () => {
      const store = new CosmosTokenStore(baseConfig);
      const token = { accessToken: 'ghu_old', expiresAt: 100 };
      const doc = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValue({ resource: doc, etag: 'etag-1' });

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(1);

      mocks.containerItemReplace.mockResolvedValueOnce({ resource: {} });
      await store.setTokenIfNewer('user-42', { accessToken: 'ghu_new', expiresAt: 200 });

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('honours dekCacheMaxEntries=0 (cache fully disabled)', async () => {
      const store = new CosmosTokenStore({ ...baseConfig, dekCacheMaxEntries: 0 });
      const token = { accessToken: 'ghu_a', expiresAt: 9999999999 };
      const doc = encryptForTest(token, FAKE_DEK, 'user-42');
      mocks.containerItemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      await store.getToken('user-42');

      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('honours dekCacheTtlMs (entry expires and is re-fetched)', async () => {
      vi.useFakeTimers();
      try {
        const store = new CosmosTokenStore({ ...baseConfig, dekCacheTtlMs: 1000 });
        const token = { accessToken: 'ghu_ttl', expiresAt: 9999999999 };
        const doc = encryptForTest(token, FAKE_DEK, 'user-42');
        mocks.containerItemRead.mockResolvedValue({ resource: doc });

        await store.getToken('user-42');
        vi.advanceTimersByTime(1500);
        await store.getToken('user-42');

        expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('evicts the oldest entry when the size cap is exceeded', async () => {
      const store = new CosmosTokenStore({ ...baseConfig, dekCacheMaxEntries: 2 });
      const make = (uid: string) => {
        const doc = encryptForTest({ accessToken: `ghu_${uid}`, expiresAt: 9999999999 }, FAKE_DEK, uid);
        return doc;
      };
      mocks.containerItemRead
        .mockResolvedValueOnce({ resource: make('a') })
        .mockResolvedValueOnce({ resource: make('b') })
        .mockResolvedValueOnce({ resource: make('c') })
        .mockResolvedValueOnce({ resource: make('a') });

      await store.getToken('a');
      await store.getToken('b');
      await store.getToken('c'); // evicts 'a'
      await store.getToken('a'); // must re-unwrap

      // 4 reads, 4 unwraps (no cache hits because 'a' was evicted by 'c').
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(4);
    });
  });
});

describe('createDefaultTokenStore (factory guard)', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env between tests; vi.resetModules so factory re-reads it.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    vi.resetModules();
  });

  it('uses InMemoryTokenStore when Cosmos is not configured and NODE_ENV !== production', async () => {
    delete process.env.AZURE_COSMOS_ENDPOINT;
    process.env.NODE_ENV = 'development';
    vi.resetModules();
    const { createDefaultTokenStore } = await import('./token-store');
    const { InMemoryTokenStore: InMem } = await import('./token-store');
    expect(createDefaultTokenStore()).toBeInstanceOf(InMem);
  });

  it('throws in production when AZURE_COSMOS_ENDPOINT is missing', async () => {
    delete process.env.AZURE_COSMOS_ENDPOINT;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { createDefaultTokenStore } = await import('./token-store');
    expect(() => createDefaultTokenStore()).toThrow(/AZURE_COSMOS_ENDPOINT/);
  });

  it('uses CosmosTokenStore when all Cosmos + Key Vault env vars are set', async () => {
    process.env.AZURE_COSMOS_ENDPOINT = 'https://example.documents.azure.com';
    process.env.AZURE_COSMOS_DATABASE = 'db';
    process.env.AZURE_COSMOS_CONTAINER = 'tokens';
    process.env.AZURE_KEY_VAULT_URL = 'https://example.vault.azure.net';
    process.env.AZURE_KEY_VAULT_KEY_NAME = 'flight-school-kek';
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { createDefaultTokenStore } = await import('./token-store');
    const { CosmosTokenStore: Cosmos } = await import('./token-store');
    expect(createDefaultTokenStore()).toBeInstanceOf(Cosmos);
  });
});

/**
 * Helper: produce a Cosmos document that {@link CosmosTokenStore.getToken}
 * would have written, using the same DEK we'll return from the mocked
 * `unwrapKey`. This lets us exercise the real decrypt path without a real
 * Key Vault.
 */
function encryptForTest(
  token: { accessToken: string; refreshToken?: string; expiresAt: number },
  dek: Buffer,
  userId: string,
  overrides: { kekId?: string; alg?: 'AES-256-GCM/A256KW'; aadExpiresAt?: number } = {},
) {
  const iv = randomBytes(12);
  const kekId = overrides.kekId ?? 'https://example.vault.azure.net/keys/flight-school-kek';
  const alg = overrides.alg ?? ('AES-256-GCM/A256KW' as const);
  const aadExpiresAt = overrides.aadExpiresAt ?? token.expiresAt;
  const aad = Buffer.from(
    JSON.stringify({ alg, expiresAt: aadExpiresAt, kekId, userId }),
    'utf8',
  );
  const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify(token), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    id: userId,
    userId,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    wrappedDek: Buffer.from([0xaa, 0xbb]).toString('base64'),
    kekId,
    alg,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: token.expiresAt,
  };
}
