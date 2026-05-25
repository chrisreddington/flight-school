import { randomBytes } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { baseCosmosConfig, encryptForTest, FAKE_DEK } from './token-store-cosmos.fixture';

// Hoisted mock state; mirrors token-store-cosmos.test.ts. Duplicated rather
// than extracted because Vitest hoists `vi.mock` factories per test file.
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
 * CosmosTokenStore concurrency & caching: setTokenIfNewer's optimistic-
 * concurrency state machine, and the DEK cache (KV unwrap suppression,
 * invalidation triggers, TTL, size cap).
 *
 * The DEK-cache tests legitimately need `unwrapKey` call-count assertions
 * because the cache's whole point is to suppress unwrap calls — there is no
 * other observable side effect. `src/lib/auth/**` is allowlisted for that.
 */
describe('CosmosTokenStore — concurrency & DEK cache', () => {
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

  describe('setTokenIfNewer (optimistic concurrency)', () => {
    const err = (msg: string, code: number) => Object.assign(new Error(msg), { code });
    const existingDoc = (expiresAt: number) => ({
      resource: { id: 'user-42', userId: 'user-42', expiresAt },
      etag: 'etag-x',
    });

    interface CasCase {
      readonly name: string;
      readonly arrange: () => void;
      readonly incoming: { accessToken: string; expiresAt: number };
      readonly expected: boolean | 'throws';
      readonly assertions?: () => void;
    }

    const cases: readonly CasCase[] = [
      {
        name: 'create-path: 404 on read → items.create',
        arrange: () => {
          mocks.itemRead.mockRejectedValue(err('not found', 404));
          mocks.itemsCreate.mockResolvedValue({ resource: {} });
        },
        incoming: { accessToken: 'ghu_first', expiresAt: 9999999999 },
        expected: true,
        assertions: () => {
          expect(mocks.itemsCreate).toHaveBeenCalledTimes(1);
          expect(mocks.itemReplace).not.toHaveBeenCalled();
          expect(mocks.itemsUpsert).not.toHaveBeenCalled();
        },
      },
      {
        name: 'replace-path: existing older → replace with If-Match etag',
        arrange: () => {
          mocks.itemRead.mockResolvedValue(existingDoc(100));
          mocks.itemReplace.mockResolvedValue({ resource: {} });
        },
        incoming: { accessToken: 'ghu_new', expiresAt: 200 },
        expected: true,
        assertions: () => {
          expect(mocks.itemReplace).toHaveBeenCalledTimes(1);
          const [, opts] = mocks.itemReplace.mock.calls[0];
          expect(opts).toEqual({ accessCondition: { type: 'IfMatch', condition: 'etag-x' } });
        },
      },
      {
        name: 'skip-path: existing newer → no encrypt, no write',
        arrange: () => mocks.itemRead.mockResolvedValue(existingDoc(200)),
        incoming: { accessToken: 'ghu_older', expiresAt: 100 },
        expected: false,
        assertions: () => {
          // Critical: skip BEFORE paying KV wrapKey cost for a doomed write.
          expect(mocks.wrapKey).not.toHaveBeenCalled();
          expect(mocks.itemReplace).not.toHaveBeenCalled();
          expect(mocks.itemsCreate).not.toHaveBeenCalled();
        },
      },
      {
        name: 'skip-path: existing same-age → no clobber on tie',
        arrange: () => mocks.itemRead.mockResolvedValue(existingDoc(100)),
        incoming: { accessToken: 'ghu_same', expiresAt: 100 },
        expected: false,
        assertions: () => expect(mocks.itemReplace).not.toHaveBeenCalled(),
      },
      {
        name: 'race: 412 PreconditionFailed on replace → false',
        arrange: () => {
          mocks.itemRead.mockResolvedValue(existingDoc(100));
          mocks.itemReplace.mockRejectedValue(err('precondition failed', 412));
        },
        incoming: { accessToken: 'ghu_new', expiresAt: 200 },
        expected: false,
      },
      {
        name: 'race: 409 Conflict on create → false',
        arrange: () => {
          mocks.itemRead.mockRejectedValue(err('not found', 404));
          mocks.itemsCreate.mockRejectedValue(err('conflict', 409));
        },
        incoming: { accessToken: 'ghu_x', expiresAt: 100 },
        expected: false,
      },
      {
        name: 'propagates non-precondition Cosmos errors',
        arrange: () => mocks.itemRead.mockRejectedValue(err('boom', 500)),
        incoming: { accessToken: 'ghu_x', expiresAt: 100 },
        expected: 'throws',
      },
    ];

    it.each(cases)('$name', async ({ arrange, incoming, expected, assertions }) => {
      arrange();
      const call = new CosmosTokenStore(baseCosmosConfig).setTokenIfNewer('user-42', incoming);

      if (expected === 'throws') await expect(call).rejects.toThrow('boom');
      else await expect(call).resolves.toBe(expected);

      assertions?.();
    });
  });

  describe('DEK cache', () => {
    it('skips Key Vault unwrapKey on a second read of the same envelope', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const doc = encryptForTest({ accessToken: 'ghu_cached', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
      mocks.itemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      await store.getToken('user-42');

      expect(mocks.unwrapKey).toHaveBeenCalledTimes(1);
    });

    it('re-unwraps when the envelope changes (DEK rotation)', async () => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const token = { accessToken: 'ghu_one', expiresAt: 9999999999 };
      mocks.itemRead.mockResolvedValueOnce({
        resource: encryptForTest(token, FAKE_DEK, 'user-42'),
      });
      await store.getToken('user-42');

      const newDek = randomBytes(32);
      const v2 = encryptForTest(token, newDek, 'user-42');
      v2.wrappedDek = Buffer.from('different-wrapped-blob').toString('base64');
      mocks.itemRead.mockResolvedValueOnce({ resource: v2 });
      mocks.unwrapKey.mockResolvedValueOnce({ result: newDek });

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    // Mutations on the SUT must drop the cached DEK so a stale value can never
    // be served after a write. Each trigger is a separate operation but the
    // observable contract is identical: next getToken re-unwraps.
    interface InvalidationCase {
      readonly trigger: string;
      readonly act: (store: CosmosTokenStore) => Promise<unknown>;
    }
    const invalidationCases: readonly InvalidationCase[] = [
      {
        trigger: 'setToken',
        act: (s) => s.setToken('user-42', { accessToken: 'ghu_second', expiresAt: 9999999999 }),
      },
      {
        trigger: 'deleteToken',
        act: (s) => s.deleteToken('user-42'),
      },
      {
        trigger: 'setTokenIfNewer (CAS write succeeds)',
        act: (s) => {
          mocks.itemReplace.mockResolvedValueOnce({ resource: {} });
          return s.setTokenIfNewer('user-42', { accessToken: 'ghu_new', expiresAt: 200 });
        },
      },
    ];

    it.each(invalidationCases)('invalidates the cache on $trigger', async ({ act }) => {
      const store = new CosmosTokenStore(baseCosmosConfig);
      const doc = encryptForTest({ accessToken: 'ghu_old', expiresAt: 100 }, FAKE_DEK, 'user-42');
      mocks.itemRead.mockResolvedValue({ resource: doc, etag: 'etag-1' });

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(1);

      await act(store);

      await store.getToken('user-42');
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('honours dekCacheMaxEntries=0 (cache fully disabled)', async () => {
      const store = new CosmosTokenStore({ ...baseCosmosConfig, dekCacheMaxEntries: 0 });
      const doc = encryptForTest({ accessToken: 'ghu_a', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
      mocks.itemRead.mockResolvedValue({ resource: doc });

      await store.getToken('user-42');
      await store.getToken('user-42');

      expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
    });

    it('honours dekCacheTtlMs (entry expires and is re-fetched)', async () => {
      vi.useFakeTimers();
      try {
        const store = new CosmosTokenStore({ ...baseCosmosConfig, dekCacheTtlMs: 1000 });
        const doc = encryptForTest({ accessToken: 'ghu_ttl', expiresAt: 9999999999 }, FAKE_DEK, 'user-42');
        mocks.itemRead.mockResolvedValue({ resource: doc });

        await store.getToken('user-42');
        vi.advanceTimersByTime(1500);
        await store.getToken('user-42');

        expect(mocks.unwrapKey).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('evicts the oldest entry when the size cap is exceeded', async () => {
      const store = new CosmosTokenStore({ ...baseCosmosConfig, dekCacheMaxEntries: 2 });
      const make = (uid: string) => encryptForTest({ accessToken: `ghu_${uid}`, expiresAt: 9999999999 }, FAKE_DEK, uid);
      mocks.itemRead
        .mockResolvedValueOnce({ resource: make('a') })
        .mockResolvedValueOnce({ resource: make('b') })
        .mockResolvedValueOnce({ resource: make('c') })
        .mockResolvedValueOnce({ resource: make('a') });

      await store.getToken('a');
      await store.getToken('b');
      await store.getToken('c'); // evicts 'a'
      await store.getToken('a'); // must re-unwrap

      // 4 reads, 4 unwraps: no cache hits because 'a' was evicted by 'c'.
      expect(mocks.unwrapKey).toHaveBeenCalledTimes(4);
    });
  });
});
