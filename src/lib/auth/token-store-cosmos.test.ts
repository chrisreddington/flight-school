import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseCosmosConfig, encryptForTest, FAKE_DEK, type EncryptedDoc } from './token-store-cosmos.fixture';

// Hoisted mock state. `vi.mock` factories run before module-level `let`s, so
// we lift everything into a `vi.hoisted` block that the factories can read.
const mocks = vi.hoisted(() => ({
  wrapKey: vi.fn(),
  unwrapKey: vi.fn(),
  itemRead: vi.fn(),
  itemDelete: vi.fn(),
  itemReplace: vi.fn(),
  itemsUpsert: vi.fn(),
  itemsCreate: vi.fn(),
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: vi.fn(function () {
    return { kind: 'mock-credential' };
  }),
}));

vi.mock('@azure/keyvault-keys', () => ({
  CryptographyClient: vi.fn(function () {
    return { wrapKey: mocks.wrapKey, unwrapKey: mocks.unwrapKey };
  }),
  KnownEncryptionAlgorithms: { A256KW: 'A256KW' },
}));

vi.mock('@azure/cosmos', () => ({
  CosmosClient: vi.fn(function () {
    return {
      database: () => ({
        container: () => ({
          item: () => ({
            read: mocks.itemRead,
            delete: mocks.itemDelete,
            replace: mocks.itemReplace,
          }),
          items: {
            upsert: mocks.itemsUpsert,
            create: mocks.itemsCreate,
            query: () => ({ hasMoreResults: vi.fn(), fetchNext: vi.fn() }),
          },
        }),
      }),
    };
  }),
}));

import { CosmosTokenStore } from './token-store';

/**
 * CosmosTokenStore envelope-encryption behaviour: write-time encryption, the
 * read-time decrypt path, and all AAD/tamper rejection cases.
 *
 * `src/lib/auth/**` is allowlisted for `toHaveBeenCalled*` assertions
 * (see scripts/check-test-boundaries.mjs) because this module IS the
 * system-seam wrapper for Cosmos + Key Vault. We still prefer behavioural
 * assertions (round-trip through `getToken`) wherever the API surface
 * supports it; raw call assertions are reserved for the two security-critical
 * invariants we can't observe any other way: "no plaintext leaks into the
 * persisted document" and "we never paid the KV unwrap cost when we
 * short-circuited on a userId mismatch".
 */
describe('CosmosTokenStore — envelope encryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.wrapKey.mockResolvedValue({ result: new Uint8Array([0xaa, 0xbb, 0xcc]) });
    mocks.unwrapKey.mockResolvedValue({ result: FAKE_DEK });
    mocks.itemsUpsert.mockResolvedValue({ resource: {} });
    mocks.itemDelete.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setToken', () => {
    it('wraps DEK with A256KW and persists ciphertext only (no plaintext leak)', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const token = {
        accessToken: 'ghu_supersecret',
        refreshToken: 'ghr_refresh',
        expiresAt: 9999999999,
      };

      await store.setToken('user-42', token);

      const [wrapAlg, wrapDek] = mocks.wrapKey.mock.calls[0];
      expect(wrapAlg).toBe('A256KW');
      expect((wrapDek as Uint8Array).length).toBe(32);

      const [doc] = mocks.itemsUpsert.mock.calls[0];
      expect(doc).toMatchObject({
        userId: 'user-42',
        alg: 'AES-256-GCM/A256KW',
        kekId: expect.stringContaining('flight-school-kek'),
      });
      // IV is the GCM standard 12 bytes; tag is 16 bytes (both base64).
      expect(Buffer.from(doc.iv, 'base64').length).toBe(12);
      expect(Buffer.from(doc.authTag, 'base64').length).toBe(16);
      // Persisted document MUST NOT contain plaintext token values anywhere.
      expect(JSON.stringify(doc)).not.toContain('ghu_supersecret');
      expect(JSON.stringify(doc)).not.toContain('ghr_refresh');
    });
  });

  describe('getToken', () => {
    it('unwraps DEK and decrypts the envelope', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const token = { accessToken: 'ghu_roundtrip', expiresAt: 9999999999 };
      mocks.itemRead.mockResolvedValue({
        resource: encryptForTest(token, FAKE_DEK, 'user-42'),
      });

      await expect(store.getToken('user-42')).resolves.toEqual(token);
      expect(mocks.unwrapKey).toHaveBeenCalledWith('A256KW', expect.any(Buffer));
    });

    it('returns null on 404 from Cosmos', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      mocks.itemRead.mockRejectedValue(Object.assign(new Error('not found'), { code: 404 }));
      await expect(store.getToken('nobody')).resolves.toBeNull();
    });

    it('returns expired records so callers can refresh (mirrors InMemoryTokenStore)', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const token = { accessToken: 'ghu_old', refreshToken: 'ghr_valid', expiresAt: 1 };
      mocks.itemRead.mockResolvedValue({
        resource: encryptForTest(token, FAKE_DEK, 'user-42'),
      });
      await expect(store.getToken('user-42')).resolves.toEqual(token);
    });

    it('returns null when the stored document is for a different userId (no decrypt attempt)', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const other = encryptForTest({ accessToken: 'ghu_other', expiresAt: 9999999999 }, FAKE_DEK, 'attacker');
      mocks.itemRead.mockResolvedValue({ resource: other });

      await expect(store.getToken('victim')).resolves.toBeNull();
      // Critical: short-circuit before paying the KV unwrap cost.
      expect(mocks.unwrapKey).not.toHaveBeenCalled();
    });

    // AEAD/AAD tamper cases: every mutated field must cause decrypt to throw.
    // Cross-user replay sits in this table because from the SUT's POV it is
    // just "AAD bound to a different userId than the document claims".
    interface TamperCase {
      readonly name: string;
      readonly userId: string;
      readonly build: () => EncryptedDoc;
    }
    const tamperCases: readonly TamperCase[] = [
      {
        name: 'tampered authTag (bit flip)',
        userId: 'user-42',
        build: () => {
          const doc = encryptForTest({ accessToken: 'ghu_x', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
          const tag = Buffer.from(doc.authTag, 'base64');
          tag[0] ^= 0x01;
          doc.authTag = tag.toString('base64');
          return doc;
        },
      },
      {
        name: 'tampered expiresAt (AAD mismatch)',
        userId: 'user-42',
        build: () => {
          const doc = encryptForTest({ accessToken: 'ghu_x', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
          doc.expiresAt += 1;
          return doc;
        },
      },
      {
        name: 'tampered kekId (AAD mismatch)',
        userId: 'user-42',
        build: () => {
          const doc = encryptForTest({ accessToken: 'ghu_x', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
          doc.kekId = 'https://example.vault.azure.net/keys/some-other-key';
          return doc;
        },
      },
      {
        name: 'cross-user replay (envelope AAD-bound to attacker, re-labelled as victim)',
        userId: 'victim',
        build: () => {
          const envelope = encryptForTest({ accessToken: 'ghu_attacker', expiresAt: 9999999999 }, FAKE_DEK, 'attacker');
          return { ...envelope, id: 'victim', userId: 'victim' };
        },
      },
    ];

    it.each(tamperCases)('throws on $name', async ({ build, userId }) => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      mocks.itemRead.mockResolvedValue({ resource: build() });
      await expect(store.getToken(userId)).rejects.toThrow();
    });
  });

  describe('deleteToken & cleanupExpired', () => {
    it('deleteToken removes the document', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      await store.deleteToken('user-42');
      expect(mocks.itemDelete).toHaveBeenCalledTimes(1);
    });

    it('deleteToken tolerates 404', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      mocks.itemDelete.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 404 }));
      await expect(store.deleteToken('user-42')).resolves.toBeUndefined();
    });

    it('cleanupExpired is a no-op (refresh token may still be valid)', async () => {
      // Mirrors InMemoryTokenStore: we cannot derive refresh-token expiry
      // from access-token expiresAt, so sweeping would delete recoverable
      // records. Only explicit sign-out (deleteToken) deletes.
      const store = new CosmosTokenStore(baseCosmosConfig);
      await expect(store.cleanupExpired()).resolves.toBe(0);
      expect(mocks.itemDelete).not.toHaveBeenCalled();
    });
  });
});
