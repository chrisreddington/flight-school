/**
 * Backend-agnostic {@link DocumentStore} contract suite.
 *
 * Every adapter (file today, sqlite next, Cosmos later) must pass this exact
 * suite, which is how cross-backend parity is enforced rather than hoped for.
 * Adapter-specific test files set up their backend, then call
 * {@link describeDocumentStoreContract} with a factory that returns a fresh,
 * empty store. The suite only ever touches partitions it creates, so multiple
 * adapters can run in one process without colliding.
 *
 * @module storage/document-store/contract
 */

import { describe, expect, it } from 'vitest';

import {
  DocumentConflictError,
  SINGLETON_DOCUMENT_ID,
  type ContainerName,
  type DocumentEnvelope,
  type DocumentStore,
} from './types';

/** A small domain body used throughout the contract tests. */
interface SampleBody {
  label: string;
  count: number;
  note: string | null;
}

const CONTAINER: ContainerName = 'skills';

/**
 * Register the full contract suite against a single adapter.
 *
 * @param label - Human label for the adapter (shown in test output).
 * @param getStore - Factory returning a ready, empty store. Called once per
 *   `it`, so each test gets a clean backend with no cross-test bleed.
 * @param options - Optional adapter-specific hooks. `getPairedStores` returns
 *   TWO independent store instances over the SAME physical backend; when
 *   provided, the suite adds a cross-instance CAS case proving the single-winner
 *   invariant holds across instances, not just within one. Adapters that cannot
 *   express two instances over one backend simply omit it.
 */
export function describeDocumentStoreContract(
  label: string,
  getStore: () => Promise<DocumentStore> | DocumentStore,
  options: { getPairedStores?: () => Promise<[DocumentStore, DocumentStore]> } = {},
): void {
  describe(`DocumentStore contract: ${label}`, () => {
    const body: SampleBody = { label: 'alpha', count: 1, note: null };

    it('returns null for an absent document', async () => {
      const store = await getStore();
      expect(await store.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
      expect(await store.getEnvelope(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
    });

    it('round-trips a body through put then get', async () => {
      const store = await getStore();
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      expect(await store.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toEqual(body);
    });

    it('preserves null fields in the body', async () => {
      const store = await getStore();
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      const stored = await store.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      expect(stored?.note).toBeNull();
    });

    it('exposes etag, updatedAt and metadata on the envelope', async () => {
      const store = await getStore();
      const written = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, {
        metadata: { type: 'profile', status: 'active' },
      });
      expect(written.etag).toBeTruthy();
      expect(written.updatedAt).toBeTruthy();
      expect(written.metadata).toEqual({ type: 'profile', status: 'active' });

      const envelope = await store.getEnvelope<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      expect(envelope?.etag).toBe(written.etag);
      expect(envelope?.metadata).toEqual({ type: 'profile', status: 'active' });
    });

    it('omits null and undefined metadata fields', async () => {
      const store = await getStore();
      const written = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, {
        metadata: { type: 'profile', status: undefined, parentId: undefined, sortKey: undefined },
      });
      expect(written.metadata).toEqual({ type: 'profile' });
    });

    it('rejects an ifNoneMatch create when the document already exists', async () => {
      const store = await getStore();
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      await expect(
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, { ifNoneMatch: '*' }),
      ).rejects.toBeInstanceOf(DocumentConflictError);
    });

    it('allows an ifNoneMatch create when the document is absent', async () => {
      const store = await getStore();
      const written = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, {
        ifNoneMatch: '*',
      });
      expect(written.body).toEqual(body);
    });

    it('resolves concurrent ifNoneMatch creates to exactly one winner', async () => {
      const store = await getStore();
      const outcomes = await Promise.allSettled([
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, label: 'first' }, { ifNoneMatch: '*' }),
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, label: 'second' }, { ifNoneMatch: '*' }),
      ]);

      const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);

      const winner = (winners[0] as PromiseFulfilledResult<DocumentEnvelope<SampleBody>>).value;
      const persisted = await store.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      expect(persisted).toEqual(winner.body);
    });

    it('advances the etag on a matching ifMatch update', async () => {
      const store = await getStore();
      const first = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      const second = await store.put(
        CONTAINER,
        'user-a',
        SINGLETON_DOCUMENT_ID,
        { ...body, count: 2 },
        { ifMatch: first.etag },
      );
      expect(second.etag).not.toBe(first.etag);
      expect(second.body.count).toBe(2);
    });

    it('advances the etag even on an identical rewrite', async () => {
      const store = await getStore();
      const first = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      const second = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, {
        ifMatch: first.etag,
      });
      expect(second.etag).not.toBe(first.etag);
    });

    it('rejects an ifMatch update against a stale etag', async () => {
      const store = await getStore();
      const first = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, { ifMatch: first.etag });
      await expect(
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, { ifMatch: first.etag }),
      ).rejects.toBeInstanceOf(DocumentConflictError);
    });

    it('resolves concurrent ifMatch updates to exactly one winner', async () => {
      const store = await getStore();
      const seeded = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);

      // Both writers hold the SAME pre-race etag. For async-I/O adapters (file)
      // both calls reach their read-check before either write commits — a read
      // (fs.readFile) never resolves synchronously, so both are in-flight before
      // either write — so without serialisation both would observe a matching
      // etag and both would win. For synchronous adapters (sqlite, DatabaseSync)
      // the two calls run strictly sequentially and one-winner falls out of the
      // ordering itself; the assertions below still pin CAS correctness (one
      // winner, one DocumentConflictError) on every backend. Cross-connection
      // atomicity for sqlite is exercised in cross-process.integration.test.ts.
      const outcomes = await Promise.allSettled([
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 1 }, { ifMatch: seeded.etag }),
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 2 }, { ifMatch: seeded.etag }),
      ]);

      const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);

      const winner = (winners[0] as PromiseFulfilledResult<DocumentEnvelope<SampleBody>>).value;
      const persisted = await store.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      expect(persisted).toEqual(winner.body);
    });

    it('never resurrects a document removed concurrently with a stale ifMatch update', async () => {
      const store = await getStore();
      const seeded = await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);

      // A stale-etag update racing a remove must never leave the losing write's
      // body behind. If the update commits first, the remove then deletes it; if
      // the remove commits first, the update sees an absent doc and its etag
      // check fails. Either ordering ends with no document — the put outcome
      // itself is order-dependent, so only the no-resurrection invariant is
      // asserted.
      await Promise.allSettled([
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 99 }, { ifMatch: seeded.etag }),
        store.remove(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID),
      ]);

      expect(await store.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
    });

    if (options.getPairedStores) {
      it('resolves concurrent ifMatch updates across two instances over one backend to one winner', async () => {
        // Two SEPARATE instances over the SAME physical backend. A per-instance
        // lock (the round-3 regression) would give each its own mutex and let
        // both observe the seeded etag and both win; the invariant demands a
        // single winner regardless of which instance issued the write.
        const [storeOne, storeTwo] = await options.getPairedStores!();
        const seeded = await storeOne.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);

        const outcomes = await Promise.allSettled([
          storeOne.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 1 }, { ifMatch: seeded.etag }),
          storeTwo.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 2 }, { ifMatch: seeded.etag }),
        ]);

        const winners = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        const losers = outcomes.filter((outcome) => outcome.status === 'rejected');
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect((losers[0] as PromiseRejectedResult).reason).toBeInstanceOf(DocumentConflictError);

        // A read through EITHER instance agrees on the single coherent winner.
        const winner = (winners[0] as PromiseFulfilledResult<DocumentEnvelope<SampleBody>>).value;
        expect(await storeTwo.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toEqual(winner.body);
      });

      it('never resurrects a document removed through one instance while another updates it', async () => {
        // The remove-vs-put no-resurrection invariant must also hold when the two
        // racers are SEPARATE instances over one backend: remove() takes the same
        // canonical per-document lock as put(), so a stale update on one instance
        // cannot reinstate a document deleted through the other.
        const [storeOne, storeTwo] = await options.getPairedStores!();
        const seeded = await storeOne.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);

        await Promise.allSettled([
          storeOne.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { ...body, count: 99 }, { ifMatch: seeded.etag }),
          storeTwo.remove(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID),
        ]);

        // Absent from BOTH instances — no torn or resurrected document survives.
        expect(await storeOne.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
        expect(await storeTwo.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
      });
    }

    it('rejects an ifMatch update against an absent document', async () => {
      const store = await getStore();
      await expect(
        store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body, { ifMatch: 'whatever' }),
      ).rejects.toBeInstanceOf(DocumentConflictError);
    });

    it('treats remove as idempotent', async () => {
      const store = await getStore();
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, body);
      await store.remove(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      await expect(store.remove(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).resolves.toBeUndefined();
      expect(await store.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
    });

    it('rejects unsafe partitionKey and id segments on every operation', async () => {
      const store = await getStore();
      const unsafe = '../escape';

      await expect(store.get(CONTAINER, unsafe, SINGLETON_DOCUMENT_ID)).rejects.toThrow();
      await expect(store.getEnvelope(CONTAINER, 'user-a', unsafe)).rejects.toThrow();
      await expect(store.put(CONTAINER, unsafe, SINGLETON_DOCUMENT_ID, body)).rejects.toThrow();
      await expect(store.put(CONTAINER, 'user-a', unsafe, body)).rejects.toThrow();
      await expect(store.remove(CONTAINER, unsafe, SINGLETON_DOCUMENT_ID)).rejects.toThrow();
      await expect(store.list(CONTAINER, unsafe)).rejects.toThrow();
      await expect(store.removeByParent(CONTAINER, unsafe, 'parent-1')).rejects.toThrow();
      await expect(store.deletePartition(CONTAINER, unsafe)).rejects.toThrow();
    });

    it('lists every document in a partition', async () => {
      const store = await getStore();
      await store.put('track-steps', 'user-a', 'step-1', { label: 'one' });
      await store.put('track-steps', 'user-a', 'step-2', { label: 'two' });
      const result = await store.list('track-steps', 'user-a');
      expect(result.items.map((item) => item.id).sort()).toEqual(['step-1', 'step-2']);
    });

    it('filters a list by indexed metadata', async () => {
      const store = await getStore();
      await store.put(
        'track-steps',
        'user-a',
        'step-1',
        { label: 'one' },
        {
          metadata: { status: 'complete' },
        },
      );
      await store.put(
        'track-steps',
        'user-a',
        'step-2',
        { label: 'two' },
        {
          metadata: { status: 'active' },
        },
      );
      const result = await store.list('track-steps', 'user-a', { status: 'active' });
      expect(result.items.map((item) => item.id)).toEqual(['step-2']);
    });

    it('orders a list deterministically by sortKey with id as tie-break', async () => {
      const store = await getStore();
      // Identical sortKey forces the id tie-break to decide ordering.
      await store.put(
        'track-steps',
        'user-a',
        'step-b',
        { label: 'b' },
        {
          metadata: { sortKey: '0001' },
        },
      );
      await store.put(
        'track-steps',
        'user-a',
        'step-a',
        { label: 'a' },
        {
          metadata: { sortKey: '0001' },
        },
      );
      await store.put(
        'track-steps',
        'user-a',
        'step-c',
        { label: 'c' },
        {
          metadata: { sortKey: '0001' },
        },
      );
      const ascending = await store.list('track-steps', 'user-a', { orderBy: 'sortKey' });
      expect(ascending.items.map((item) => item.id)).toEqual(['step-a', 'step-b', 'step-c']);

      const descending = await store.list('track-steps', 'user-a', {
        orderBy: 'sortKey',
        direction: 'desc',
      });
      expect(descending.items.map((item) => item.id)).toEqual(['step-c', 'step-b', 'step-a']);
    });

    it('paginates deterministically across equal ordering values', async () => {
      const store = await getStore();
      for (const id of ['step-a', 'step-b', 'step-c', 'step-d']) {
        await store.put(
          'track-steps',
          'user-a',
          id,
          { label: id },
          {
            metadata: { sortKey: 'same' },
          },
        );
      }
      const firstPage = await store.list('track-steps', 'user-a', {
        orderBy: 'sortKey',
        limit: 2,
      });
      expect(firstPage.items.map((item) => item.id)).toEqual(['step-a', 'step-b']);
      expect(firstPage.nextCursor).toBeTruthy();

      const secondPage = await store.list('track-steps', 'user-a', {
        orderBy: 'sortKey',
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      expect(secondPage.items.map((item) => item.id)).toEqual(['step-c', 'step-d']);
      expect(secondPage.nextCursor).toBeUndefined();
    });

    it('removes only documents under a matching parent, idempotently', async () => {
      const store = await getStore();
      await store.put(
        'track-steps',
        'user-a',
        'step-1',
        { label: 'one' },
        {
          metadata: { parentId: 'enroll-1' },
        },
      );
      await store.put(
        'track-steps',
        'user-a',
        'step-2',
        { label: 'two' },
        {
          metadata: { parentId: 'enroll-2' },
        },
      );
      await store.removeByParent('track-steps', 'user-a', 'enroll-1');
      const remaining = await store.list('track-steps', 'user-a');
      expect(remaining.items.map((item) => item.id)).toEqual(['step-2']);

      // Idempotent: removing a parent with zero matches is a success.
      await expect(store.removeByParent('track-steps', 'user-a', 'enroll-1')).resolves.toBeUndefined();
    });

    it('wipes a whole partition', async () => {
      const store = await getStore();
      await store.put('track-steps', 'user-a', 'step-1', { label: 'one' });
      await store.put('track-steps', 'user-a', 'step-2', { label: 'two' });
      await store.deletePartition('track-steps', 'user-a');
      const result = await store.list('track-steps', 'user-a');
      expect(result.items).toEqual([]);
    });

    it('isolates partitions from one another', async () => {
      const store = await getStore();
      await store.put(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID, { label: 'a', count: 1, note: null });
      await store.put(CONTAINER, 'user-b', SINGLETON_DOCUMENT_ID, { label: 'b', count: 2, note: null });

      const fromA = await store.get<SampleBody>(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID);
      const fromB = await store.get<SampleBody>(CONTAINER, 'user-b', SINGLETON_DOCUMENT_ID);
      expect(fromA?.label).toBe('a');
      expect(fromB?.label).toBe('b');

      // Wiping one partition must not touch the other.
      await store.deletePartition(CONTAINER, 'user-a');
      expect(await store.get(CONTAINER, 'user-a', SINGLETON_DOCUMENT_ID)).toBeNull();
      expect(await store.get(CONTAINER, 'user-b', SINGLETON_DOCUMENT_ID)).not.toBeNull();
    });
  });
}
