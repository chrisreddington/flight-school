/**
 * Backend-neutral reconciliation sweep for crash-orphaned track enrollments.
 *
 * `enroll()` creates an enrollment document (status `active`) and only THEN
 * claims the track's active slot. A crash between those two writes leaves an
 * `active` enrollment that no slot points at. {@link TracksRepo.getActiveEnrollment}
 * resolves through the slot, so the orphan is already invisible to the product —
 * this sweep is belt-and-braces hygiene that demotes it to `abandoned` so the
 * `active` record does not accumulate.
 *
 * The sweep is deliberately gentle: it skips any orphan younger than
 * {@link ENROLL_RECONCILE_GRACE_MS}. Without that window a sweep firing inside a
 * live `enroll()` — after the candidate is created but before its slot claim
 * lands — would demote the in-flight candidate to `abandoned` while the claim
 * still succeeds, handing a caller that contracted `active` an `abandoned`
 * enrollment with no error. The grace check reads the immutable
 * {@link TrackEnrollment.enrolledAt}, never the envelope's `updatedAt` (which
 * advances on every write and would let a revisited orphan dodge the sweep
 * forever).
 *
 * It depends only on the {@link UserScopedStore} contract, so it runs unchanged
 * on every storage backend and never reaches a transaction or sqlite primitive.
 *
 * @module tracks/enrollment-reconciliation
 */

import { DocumentConflictError } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { activeSlotId } from './ids';
import type { TrackEnrollment } from './types';

/** Container holding both enrollment documents and active-slot pointers. */
const ENROLLMENTS = 'track-enrollments';

/**
 * Grace window (ms) an unslotted `active` enrollment must outlive before the
 * sweep may demote it. Defaults to 30s — comfortably longer than any single
 * `enroll()` round-trip, so a live candidate is never demoted mid-flight.
 */
export const ENROLL_RECONCILE_GRACE_MS = 30_000;

/** The active-slot body: a pointer to the enrollment currently in force. */
interface ActiveSlotBody {
  enrollmentId: string;
}

/** Injectable seams (clock, grace window) for {@link reconcileTrackEnrollments}. */
export interface ReconcileOptions {
  /** Clock seam returning an ISO 8601 "now"; defaults to wall-clock. */
  now?: () => string;
  /** Grace window in ms; defaults to {@link ENROLL_RECONCILE_GRACE_MS}. */
  graceMs?: number;
}

/** Outcome of one reconciliation pass over a user's enrollments. */
export interface ReconcileResult {
  /** Active enrollments inspected this pass. */
  scanned: number;
  /** Orphans demoted to `abandoned` this pass. */
  demoted: number;
}

/**
 * Demote crash-orphaned `active` enrollments for one user to `abandoned`.
 *
 * Lists every `active` enrollment, resolves each track's active slot, and
 * demotes any enrollment the slot does NOT point at once it has aged past the
 * grace window. Slot-pointed enrollments and within-grace orphans are left
 * alone. The demote is a CAS write; a lost race (a concurrent writer advanced
 * the same orphan) is swallowed — the orphan is no longer ours to demote and
 * the slot resolution self-heals.
 *
 * @param store - User-scoped store; the caller binds it to one authenticated
 *   user, mirroring how {@link TracksRepo} is constructed.
 * @param options - Optional clock and grace-window seams.
 * @returns Counts of enrollments scanned and orphans demoted.
 */
export async function reconcileTrackEnrollments(
  store: UserScopedStore,
  options: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const nowMs = Date.parse((options.now ?? (() => new Date().toISOString()))());
  const graceMs = options.graceMs ?? ENROLL_RECONCILE_GRACE_MS;

  const actives = await store.list<TrackEnrollment>(ENROLLMENTS, {
    type: 'enrollment',
    status: 'active',
  });

  const slotTargetCache = new Map<string, string | null>();
  let demoted = 0;

  for (const envelope of actives.items) {
    const enrollment = envelope.body;
    const slotTarget = await resolveSlotTarget(store, enrollment.trackId, slotTargetCache);
    if (slotTarget === enrollment.enrollmentId) continue;

    const ageMs = nowMs - Date.parse(enrollment.enrolledAt);
    if (ageMs < graceMs) continue;

    if (await demoteOrphan(store, envelope.etag, enrollment)) demoted += 1;
  }

  return { scanned: actives.items.length, demoted };
}

/** Resolve (and memoise) which enrollment a track's active slot points at. */
async function resolveSlotTarget(
  store: UserScopedStore,
  trackId: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const cached = cache.get(trackId);
  if (cached !== undefined) return cached;
  const slot = await store.get<ActiveSlotBody>(ENROLLMENTS, activeSlotId(trackId));
  const target = slot?.enrollmentId ?? null;
  cache.set(trackId, target);
  return target;
}

/**
 * CAS-demote one orphan to `abandoned`. Returns whether the write landed; a
 * lost race (`DocumentConflictError`) resolves to `false` rather than throwing.
 */
async function demoteOrphan(store: UserScopedStore, etag: string, enrollment: TrackEnrollment): Promise<boolean> {
  const abandoned: TrackEnrollment = { ...enrollment, status: 'abandoned' };
  try {
    await store.put(ENROLLMENTS, enrollment.enrollmentId, abandoned, {
      ifMatch: etag,
      metadata: { type: 'enrollment', status: 'abandoned', parentId: enrollment.trackId },
    });
    return true;
  } catch (error) {
    if (error instanceof DocumentConflictError) return false;
    throw error;
  }
}
