/**
 * Parity tests for {@link TracksRepo} enrollment + active-slot behaviour (§B.4).
 *
 * The active-slot document is the SINGLE source of truth for "which enrollment
 * is current". These suites pin the invariants that make that safe under
 * concurrency: `enroll()` is idempotent while an enrollment is active, never
 * demotes a live winner, never removes the slot, and resolves a single winner
 * when two enrollers race — identically on the file and sqlite adapters. The
 * deterministic `RecordingStore` simulations then drive the lost-race paths a
 * real race could only reproduce flakily.
 *
 * Step-instance behaviour lives in the sibling `tracks-repo.steps.test.ts`.
 *
 * @module tracks/tracks-repo.enroll.test
 */

import { promises as fs } from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { activeSlotId } from './ids';
import { createTracksRepo } from './tracks-repo';
import type { TrackEnrollment } from './types';
import { EnrollmentContentionError } from './types';
import {
  adapterCases,
  deterministicOptions,
  freshTempDir,
  makeScopedStore,
  RecordingStore,
  seedEnrollment,
  SQLITE_AVAILABLE,
  TRACK_A,
  TRACK_B,
} from './tracks-repo.harness';

const ENROLLMENTS = 'track-enrollments';

/** Count the non-slot enrollment documents (the slot shares the container). */
async function activeEnrollments(store: UserScopedStore): Promise<TrackEnrollment[]> {
  const page = await store.list<TrackEnrollment>(ENROLLMENTS, { type: 'enrollment', status: 'active' });
  return page.items.map((envelope) => envelope.body);
}

describe.each(adapterCases)('TracksRepo enroll on the $name adapter', ({ name, make }) => {
  const maybeIt = name === 'sqlite' && !SQLITE_AVAILABLE ? it.skip : it;
  let dir: string;
  let raw: DocumentStore;
  let store: UserScopedStore;

  beforeEach(async () => {
    dir = await freshTempDir();
    raw = await make(dir);
    store = makeScopedStore(raw);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  maybeIt('creates an active enrollment the slot points at', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const enrollment = await repo.enroll(TRACK_A);

    expect(enrollment.trackId).toBe(TRACK_A);
    expect(enrollment.status).toBe('active');
    const active = await repo.getActiveEnrollment(TRACK_A);
    expect(active?.enrollmentId).toBe(enrollment.enrollmentId);
  });

  maybeIt('is idempotent while an enrollment is active', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const first = await repo.enroll(TRACK_A);
    const second = await repo.enroll(TRACK_A);

    expect(second.enrollmentId).toBe(first.enrollmentId);
    expect(await activeEnrollments(store)).toHaveLength(1);
  });

  maybeIt('resolves a single winner when two enrollers race the same track', async () => {
    const repoOne = createTracksRepo(store, deterministicOptions('c1'));
    const repoTwo = createTracksRepo(store, deterministicOptions('c2'));

    const [first, second] = await Promise.all([repoOne.enroll(TRACK_A), repoTwo.enroll(TRACK_A)]);

    expect(first.enrollmentId).toBe(second.enrollmentId);
    expect(await activeEnrollments(store)).toHaveLength(1);
    const active = await repoOne.getActiveEnrollment(TRACK_A);
    expect(active?.enrollmentId).toBe(first.enrollmentId);
  });

  maybeIt('resolves a single winner when two enrollers race to RECLAIM a stale slot', async () => {
    // Unlike the empty-slot race (atomic create), reclaim swaps an existing slot
    // off a terminal target via `ifMatch` CAS. Both racers read the SAME slot
    // etag; the backend must still admit exactly one writer.
    await seedEnrollment(store, 'term-1', TRACK_A, 'abandoned');
    await store.put(
      ENROLLMENTS,
      activeSlotId(TRACK_A),
      { enrollmentId: 'term-1' },
      { metadata: { type: 'active-slot' } },
    );

    const repoOne = createTracksRepo(store, deterministicOptions('c1'));
    const repoTwo = createTracksRepo(store, deterministicOptions('c2'));

    const [first, second] = await Promise.all([repoOne.enroll(TRACK_A), repoTwo.enroll(TRACK_A)]);

    expect(first.enrollmentId).toBe(second.enrollmentId);
    expect(first.enrollmentId).not.toBe('term-1');
    const active = await repoOne.getActiveEnrollment(TRACK_A);
    expect(active?.enrollmentId).toBe(first.enrollmentId);
    // Exactly one fresh winner joined the abandoned target — no double-claim.
    expect(await activeEnrollments(store)).toHaveLength(1);
  });

  maybeIt('keeps independent slots for two different tracks', async () => {
    const repo = createTracksRepo(store, deterministicOptions());

    const alpha = await repo.enroll(TRACK_A);
    const beta = await repo.enroll(TRACK_B);

    expect(alpha.enrollmentId).not.toBe(beta.enrollmentId);
    expect((await repo.getActiveEnrollment(TRACK_A))?.enrollmentId).toBe(alpha.enrollmentId);
    expect((await repo.getActiveEnrollment(TRACK_B))?.enrollmentId).toBe(beta.enrollmentId);
  });

  describe('getActiveEnrollment returns null when the slot does not resolve a live winner', () => {
    maybeIt('when no slot exists', async () => {
      const repo = createTracksRepo(store, deterministicOptions());
      expect(await repo.getActiveEnrollment(TRACK_A)).toBeNull();
    });

    maybeIt('when the slot points at an absent target', async () => {
      await store.put(
        ENROLLMENTS,
        activeSlotId(TRACK_A),
        { enrollmentId: 'gone' },
        {
          metadata: { type: 'active-slot' },
        },
      );
      const repo = createTracksRepo(store, deterministicOptions());
      expect(await repo.getActiveEnrollment(TRACK_A)).toBeNull();
    });

    maybeIt('when the slot points at a terminal target', async () => {
      await seedEnrollment(store, 'term-1', TRACK_A, 'abandoned');
      await store.put(
        ENROLLMENTS,
        activeSlotId(TRACK_A),
        { enrollmentId: 'term-1' },
        {
          metadata: { type: 'active-slot' },
        },
      );
      const repo = createTracksRepo(store, deterministicOptions());
      expect(await repo.getActiveEnrollment(TRACK_A)).toBeNull();
    });

    maybeIt('when the slot points at a target for a different track', async () => {
      await seedEnrollment(store, 'foreign-1', TRACK_B, 'active');
      await store.put(
        ENROLLMENTS,
        activeSlotId(TRACK_A),
        { enrollmentId: 'foreign-1' },
        {
          metadata: { type: 'active-slot' },
        },
      );
      const repo = createTracksRepo(store, deterministicOptions());
      expect(await repo.getActiveEnrollment(TRACK_A)).toBeNull();
    });
  });

  maybeIt('treats an orphaned active enrollment as invisible and self-heals on enroll', async () => {
    await seedEnrollment(store, 'orphan-1', TRACK_A, 'active');
    const repo = createTracksRepo(store, deterministicOptions());

    expect(await repo.getActiveEnrollment(TRACK_A)).toBeNull();
    const fresh = await repo.enroll(TRACK_A);

    expect(fresh.enrollmentId).not.toBe('orphan-1');
    expect((await repo.getActiveEnrollment(TRACK_A))?.enrollmentId).toBe(fresh.enrollmentId);
    const orphan = await store.get<TrackEnrollment>(ENROLLMENTS, 'orphan-1');
    expect(orphan?.status).toBe('active');
  });
});

describe('TracksRepo enroll lost-race simulations (file adapter)', () => {
  const make = adapterCases[0].make;
  let dir: string;
  let inner: UserScopedStore;
  let spy: RecordingStore;

  beforeEach(async () => {
    dir = await freshTempDir();
    inner = makeScopedStore(await make(dir));
    spy = new RecordingStore(inner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('bridges a lost first-enroll race to the winner and abandons its own candidate', async () => {
    const repo = createTracksRepo(spy, deterministicOptions('mine'));
    const slotId = activeSlotId(TRACK_A);

    spy.failNextPutWhere(
      (call) => call.id === slotId,
      async () => {
        await seedEnrollment(inner, 'winner-1', TRACK_A, 'active');
        await inner.put(
          ENROLLMENTS,
          slotId,
          { enrollmentId: 'winner-1' },
          {
            metadata: { type: 'active-slot' },
          },
        );
      },
    );

    const resolved = await repo.enroll(TRACK_A);

    expect(resolved.enrollmentId).toBe('winner-1');
    const ownCandidate = await inner.get<TrackEnrollment>(ENROLLMENTS, 'mine-1');
    expect(ownCandidate?.status).toBe('abandoned');
    expect(spy.removeCalls).toEqual([]);
    expect(spy.putCount(ENROLLMENTS, (id) => id === 'winner-1')).toBe(0);
  });

  it('reclaims a slot pointing at a foreign-track winner without touching it', async () => {
    await seedEnrollment(inner, 'foreign-1', TRACK_B, 'active');
    await inner.put(
      ENROLLMENTS,
      activeSlotId(TRACK_A),
      { enrollmentId: 'foreign-1' },
      {
        metadata: { type: 'active-slot' },
      },
    );
    const repo = createTracksRepo(spy, deterministicOptions('mine'));

    const resolved = await repo.enroll(TRACK_A);

    expect(resolved.trackId).toBe(TRACK_A);
    const foreign = await inner.get<TrackEnrollment>(ENROLLMENTS, 'foreign-1');
    expect(foreign?.status).toBe('active');
    expect(foreign?.trackId).toBe(TRACK_B);
    expect(spy.putCount(ENROLLMENTS, (id) => id === 'foreign-1')).toBe(0);
    expect(spy.removeCalls).toEqual([]);
  });

  it('throws EnrollmentContentionError when every attempt loses and no winner resolves', async () => {
    await seedEnrollment(inner, 'dead-1', TRACK_A, 'abandoned');
    await inner.put(
      ENROLLMENTS,
      activeSlotId(TRACK_A),
      { enrollmentId: 'dead-1' },
      {
        metadata: { type: 'active-slot' },
      },
    );
    const repo = createTracksRepo(spy, deterministicOptions('mine'));

    const slotId = activeSlotId(TRACK_A);
    for (let attempt = 0; attempt < 3; attempt++) {
      spy.failNextPutWhere((call) => call.id === slotId);
    }

    await expect(repo.enroll(TRACK_A)).rejects.toBeInstanceOf(EnrollmentContentionError);
    const ownCandidate = await inner.get<TrackEnrollment>(ENROLLMENTS, 'mine-1');
    expect(ownCandidate?.status).toBe('abandoned');
    const displaced = await inner.get<TrackEnrollment>(ENROLLMENTS, 'dead-1');
    expect(displaced?.status).toBe('abandoned');
    expect(spy.removeCalls).toEqual([]);
  });
});
