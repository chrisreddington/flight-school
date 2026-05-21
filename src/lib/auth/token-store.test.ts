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
    containerItemsUpsert: vi.fn(),
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
}

function buildMockContainer() {
  return {
    item: (): ItemRef => ({
      read: mocks.containerItemRead,
      delete: mocks.containerItemDelete,
    }),
    items: {
      upsert: mocks.containerItemsUpsert,
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

  it('treats expired tokens as missing', async () => {
    const store = new InMemoryTokenStore();
    await store.setToken('u1', { accessToken: 'ghu_x', expiresAt: 1 });
    await expect(store.getToken('u1')).resolves.toBeNull();
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

  it('cleanupExpired removes only expired records', async () => {
    const store = new InMemoryTokenStore();
    const past = 1;
    const future = Math.floor(Date.now() / 1000) + 3600;
    await store.setToken('expired', { accessToken: 'ghu_a', expiresAt: past });
    await store.setToken('fresh', { accessToken: 'ghu_b', expiresAt: future });
    const removed = await store.cleanupExpired();
    expect(removed).toBe(1);
    await expect(store.getToken('fresh')).resolves.toEqual({
      accessToken: 'ghu_b',
      expiresAt: future,
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

  it('get: returns null for expired tokens without unwrapping the DEK', async () => {
    const store = new CosmosTokenStore(baseConfig);
    const doc = encryptForTest({ accessToken: 'ghu_old', expiresAt: 1 }, FAKE_DEK, 'user-42');
    mocks.containerItemRead.mockResolvedValue({ resource: doc });
    await expect(store.getToken('user-42')).resolves.toBeNull();
    expect(mocks.unwrapKey).not.toHaveBeenCalled();
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

  it('cleanupExpired: deletes only expired rows', async () => {
    const store = new CosmosTokenStore(baseConfig);
    // One page of expired rows, then done.
    mocks.containerItemsQueryHasMore.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mocks.containerItemsQueryFetch.mockResolvedValueOnce({
      resources: [
        { id: 'a', userId: 'a' },
        { id: 'b', userId: 'b' },
      ],
    });

    const removed = await store.cleanupExpired();

    expect(removed).toBe(2);
    expect(mocks.containerItemDelete).toHaveBeenCalledTimes(2);
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
    const { createDefaultTokenStore } = await import('./token-store-factory');
    const { InMemoryTokenStore: InMem } = await import('./token-store');
    expect(createDefaultTokenStore()).toBeInstanceOf(InMem);
  });

  it('throws in production when AZURE_COSMOS_ENDPOINT is missing', async () => {
    delete process.env.AZURE_COSMOS_ENDPOINT;
    process.env.NODE_ENV = 'production';
    vi.resetModules();
    const { createDefaultTokenStore } = await import('./token-store-factory');
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
    const { createDefaultTokenStore } = await import('./token-store-factory');
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
