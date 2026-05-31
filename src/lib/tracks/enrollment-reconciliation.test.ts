/**
 * Parity tests for {@link reconcileTrackEnrollments} (§ reconciliation sweep).
 *
 * The sweep self-heals crash-orphaned enrollments: an enrollment whose document
 * was created (status `active`) but whose active-slot claim never landed is
 * invisible to the product (because {@link TracksRepo.getActiveEnrollment}
 * resolves through the slot), yet leaves a dangling `active` record. The sweep
 * demotes those orphans to `abandoned` — but ONLY once they age past a grace
 * window, so a sweep firing inside a live `enroll()` can never demote the
 * in-flight candidate before its slot claim resolves.
 *
 * The grace check reads the immutable {@link TrackEnrollment.enrolledAt}, never
 * the envelope's `updatedAt` (which advances on every write and would let a
 * revisited orphan dodge the sweep forever). These suites pin that, plus the
 * never-demote-the-slotted invariant, identically on the file and sqlite
 * adapters; the `RecordingStore` block then drives the lost-CAS branch a real
 * race could only reproduce flakily.
 *
 * @module tracks/enrollment-reconciliation.test
 */

import { promises as fs } from 'fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentStore } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { ENROLL_RECONCILE_GRACE_MS, reconcileTrackEnrollments } from './enrollment-reconciliation';
import { activeSlotId } from './ids';
import type { EnrollmentStatus, TrackEnrollment } from './types';
import {
  adapterCases,
  freshTempDir,
  makeScopedStore,
  RecordingStore,
  SQLITE_AVAILABLE,
  TRACK_A,
} from './tracks-repo.harness';

const ENROLLMENTS = 'track-enrollments';
const NOW_ISO = '2026-06-01T00:01:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

/** A fixed clock seam pinned at {@link NOW_ISO}. */
const fixedNow = (): string => NOW_ISO;

/** An ISO timestamp `ageMs` before {@link NOW_ISO}. */
function isoAged(ageMs: number): string {
  return new Date(NOW_MS - ageMs).toISOString();
}

/**
 * Seed an `active` enrollment document directly (bypassing the repo) so a test
 * can choose its `enrolledAt` age and whether a slot points at it.
 */
async function seedEnrollment(
  store: UserScopedStore,
  enrollmentId: string,
  enrolledAt: string,
  status: EnrollmentStatus = 'active',
): Promise<void> {
  const enrollment: TrackEnrollment = {
    enrollmentId,
    trackId: TRACK_A,
    catalogVersion: 'v1',
    status,
    enrolledAt,
    lastAccessedAt: enrolledAt,
  };
  await store.put(ENROLLMENTS, enrollmentId, enrollment, {
    ifNoneMatch: '*',
    metadata: { type: 'enrollment', status, parentId: TRACK_A },
  });
}

/** Point the active slot for {@link TRACK_A} at `enrollmentId`. */
async function seedSlot(store: UserScopedStore, enrollmentId: string): Promise<void> {
  await store.put(
    ENROLLMENTS,
    activeSlotId(TRACK_A),
    { enrollmentId },
    { ifNoneMatch: '*', metadata: { type: 'active-slot' } },
  );
}

/** Read back an enrollment's advisory status. */
async function readStatus(store: UserScopedStore, enrollmentId: string): Promise<string | undefined> {
  const enrollment = await store.get<TrackEnrollment>(ENROLLMENTS, enrollmentId);
  return enrollment?.status;
}

describe.each(adapterCases)('reconcileTrackEnrollments on the $name adapter', ({ name, make }) => {
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

  maybeIt('leaves an unslotted active enrollment younger than the grace window untouched', async () => {
    await seedEnrollment(store, 'enr-young', isoAged(ENROLL_RECONCILE_GRACE_MS - 5_000));

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.demoted).toBe(0);
    expect(await readStatus(store, 'enr-young')).toBe('active');
  });

  maybeIt('demotes an unslotted active enrollment older than the grace window', async () => {
    await seedEnrollment(store, 'enr-orphan', isoAged(ENROLL_RECONCILE_GRACE_MS + 5_000));

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.scanned).toBe(1);
    expect(result.demoted).toBe(1);
    expect(await readStatus(store, 'enr-orphan')).toBe('abandoned');
  });

  maybeIt('never demotes the enrollment the active slot points at, however old', async () => {
    await seedEnrollment(store, 'enr-live', isoAged(ENROLL_RECONCILE_GRACE_MS * 10));
    await seedSlot(store, 'enr-live');

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.demoted).toBe(0);
    expect(await readStatus(store, 'enr-live')).toBe('active');
  });

  maybeIt('demotes only the orphan when a slotted and an orphaned active coexist', async () => {
    await seedEnrollment(store, 'enr-live', isoAged(ENROLL_RECONCILE_GRACE_MS + 5_000));
    await seedSlot(store, 'enr-live');
    await seedEnrollment(store, 'enr-orphan', isoAged(ENROLL_RECONCILE_GRACE_MS + 5_000));

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.scanned).toBe(2);
    expect(result.demoted).toBe(1);
    expect(await readStatus(store, 'enr-live')).toBe('active');
    expect(await readStatus(store, 'enr-orphan')).toBe('abandoned');
  });

  maybeIt('applies the default grace window when none is supplied', async () => {
    await seedEnrollment(store, 'enr-default', isoAged(ENROLL_RECONCILE_GRACE_MS + 1_000));

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.demoted).toBe(1);
    expect(await readStatus(store, 'enr-default')).toBe('abandoned');
  });

  maybeIt('ignores enrollments already in a terminal status', async () => {
    await seedEnrollment(store, 'enr-done', isoAged(ENROLL_RECONCILE_GRACE_MS * 10), 'abandoned');

    const result = await reconcileTrackEnrollments(store, { now: fixedNow });

    expect(result.scanned).toBe(0);
    expect(result.demoted).toBe(0);
    expect(await readStatus(store, 'enr-done')).toBe('abandoned');
  });
});

describe('reconcileTrackEnrollments conflict handling (RecordingStore)', () => {
  let dir: string;
  let raw: DocumentStore;
  let recording: RecordingStore;

  beforeEach(async () => {
    dir = await freshTempDir();
    raw = await adapterCases[0].make(dir);
    recording = new RecordingStore(makeScopedStore(raw));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('swallows a lost-CAS conflict when a racing writer advances the orphan first', async () => {
    await seedEnrollment(recording, 'enr-raced', isoAged(ENROLL_RECONCILE_GRACE_MS + 5_000));
    const isDemotePut = (call: { container: string; opts?: { ifMatch?: string } }): boolean =>
      call.container === ENROLLMENTS && call.opts?.ifMatch !== undefined;
    recording.failNextPutWhere(isDemotePut);

    const result = await reconcileTrackEnrollments(recording, { now: fixedNow });

    // The demote put was attempted but lost the race; the sweep neither throws
    // nor counts it as demoted.
    expect(result.demoted).toBe(0);
    expect(recording.putCount(ENROLLMENTS, (id) => id === 'enr-raced')).toBe(2);
  });

  it('issues no write for an enrollment the slot still points at', async () => {
    await seedEnrollment(recording, 'enr-live', isoAged(ENROLL_RECONCILE_GRACE_MS + 5_000));
    await seedSlot(recording, 'enr-live');
    const writesBefore = recording.putCalls.length;

    await reconcileTrackEnrollments(recording, { now: fixedNow });

    expect(recording.putCalls.length).toBe(writesBefore);
  });

  it('issues no write for an orphan still within the grace window', async () => {
    await seedEnrollment(recording, 'enr-young', isoAged(ENROLL_RECONCILE_GRACE_MS - 5_000));
    const writesBefore = recording.putCalls.length;

    await reconcileTrackEnrollments(recording, { now: fixedNow });

    expect(recording.putCalls.length).toBe(writesBefore);
  });
});
