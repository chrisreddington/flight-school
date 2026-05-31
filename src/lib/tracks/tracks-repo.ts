/**
 * The Tracks domain repository (§B.1, §B.2) — the only sanctioned path for
 * reading and mutating a learner's track progress.
 *
 * **Backend portability is the headline invariant.** This repo achieves
 * uniqueness and idempotency purely through deterministic document ids plus
 * `put(ifNoneMatch:'*')` / `put(ifMatch:etag)` CAS and {@link DocumentConflictError}
 * — never a sqlite transaction, never a DB unique index. Its imports are pinned
 * to the dependency-free contract modules (`document-store/types`,
 * `document-store/user-scoped-store` types) so its transitive import graph never
 * reaches `withTransaction` / `DatabaseSync` / the sqlite adapter. A static
 * import-guard test enforces that; keeping it true is what lets the same repo
 * drop onto Cosmos unchanged.
 *
 * **Currency is owned by the active-slot document, not by `status`.** For each
 * track a single slot doc (`active-${slotKey(trackId)}`) points at the current
 * enrollment. {@link TracksRepo.getActiveEnrollment} resolves it as a two-step
 * point read and never scans `status:'active'`, so a crash-orphaned active
 * enrollment (created but never slotted) is invisible to the product without
 * any sweep. `enroll()` only ever repoints a slot whose target is terminal,
 * absent, or foreign — it can never demote a live winner.
 *
 * @module tracks/tracks-repo
 */

import { randomUUID } from 'node:crypto';

import { DocumentConflictError } from '../storage/document-store/types';
import type { UserScopedStore } from '../storage/document-store/user-scoped-store';
import { CATALOG_VERSION } from './catalog-data';
import { activeSlotId, assertSafeSegment, stepInstanceId } from './ids';
import { EnrollmentContentionError, type TrackEnrollment, type TrackStepInstance } from './types';

/** The container holding enrollment documents and their active-slot pointers. */
const ENROLLMENTS = 'track-enrollments';
/** The container holding per-step progress instances. */
const STEPS = 'track-steps';

/** Body shape of an active-slot pointer document. */
interface ActiveSlot {
  /** The enrollment this slot currently points at. */
  enrollmentId: string;
}

/** Maximum CAS attempts before {@link enroll} gives up and resolves the winner. */
const MAX_ENROLL_ATTEMPTS = 3;
/** Maximum CAS attempts when transitioning a step instance's status. */
const MAX_STEP_CAS_ATTEMPTS = 3;

/**
 * Injectable seams so tests can drive deterministic timestamps and ids. All
 * default to the real clock / id generator, so production callers pass nothing.
 */
export interface TracksRepoOptions {
  /** Returns the current time as an ISO 8601 string. */
  now?: () => string;
  /** Mints a fresh, safe-segment enrollment id. */
  newEnrollmentId?: () => string;
  /** The catalog version stamped onto new enrollments. */
  catalogVersion?: string;
}

/**
 * Build a Tracks repository over a user-scoped store.
 *
 * @param store - The per-user partitioned store; the repo takes it by DI so its
 *   import graph never reaches a store factory or adapter.
 * @param options - Optional clock / id / version seams for tests.
 */
export function createTracksRepo(store: UserScopedStore, options: TracksRepoOptions = {}): TracksRepo {
  return new TracksRepo(store, options);
}

/**
 * The Tracks repository. Construct via {@link createTracksRepo}. Private methods
 * (`#createEnrollment`, `#abandonOwnCandidate`) operate ONLY on documents the
 * current call created — they never touch a displaced enrollment.
 */
export class TracksRepo {
  readonly #store: UserScopedStore;
  readonly #now: () => string;
  readonly #newEnrollmentId: () => string;
  readonly #catalogVersion: string;

  constructor(store: UserScopedStore, options: TracksRepoOptions) {
    this.#store = store;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#newEnrollmentId = options.newEnrollmentId ?? (() => randomUUID());
    this.#catalogVersion = options.catalogVersion ?? CATALOG_VERSION;
  }

  /**
   * Enroll the learner in a track, returning the active enrollment.
   *
   * Idempotent when already actively enrolled: returns the existing enrollment
   * and creates nothing (never restarts a live track — that is a separate,
   * explicit future action). Only ever repoints a slot whose target is
   * terminal, absent, or foreign. See the §B.1 state machine.
   *
   * @throws {EnrollmentContentionError} only in the pathological case of three
   *   lost CAS races with no active enrollment resolvable afterwards.
   */
  async enroll(trackId: string): Promise<TrackEnrollment> {
    assertSafeSegment(trackId);
    const slotId = activeSlotId(trackId);
    let ownCandidateId: string | null = null;

    for (let attempt = 0; attempt < MAX_ENROLL_ATTEMPTS; attempt++) {
      const slotEnv = await this.#store.getEnvelope<ActiveSlot>(ENROLLMENTS, slotId);

      if (slotEnv) {
        const current = await this.#store.get<TrackEnrollment>(ENROLLMENTS, slotEnv.body.enrollmentId);
        // Already actively enrolled in THIS track → idempotent return. A slot
        // pointing at a terminal/absent/foreign-trackId target is treated as
        // reclaimable below; the displaced target is never touched.
        if (current?.status === 'active' && current.trackId === trackId) {
          if (ownCandidateId) await this.#abandonOwnCandidate(ownCandidateId);
          return current;
        }
      }

      // Create our candidate once and reuse it across retries. It is active but
      // unslotted, so getActiveEnrollment ignores it until we claim the slot.
      if (!ownCandidateId) ownCandidateId = await this.#createEnrollment(trackId);

      try {
        await this.#claimSlot(slotId, ownCandidateId, slotEnv?.etag);
        const claimed = await this.#store.get<TrackEnrollment>(ENROLLMENTS, ownCandidateId);
        if (!claimed) throw new Error(`Enrollment vanished after slot claim: ${ownCandidateId}`);
        return claimed;
      } catch (error) {
        if (!(error instanceof DocumentConflictError)) throw error;
        // Lost the race (slot moved, or first-enroll create collided). Re-read
        // and retry with the SAME candidate; never remove the slot.
      }
    }

    // Exhaustion: a concurrent writer holds the slot. Discard our candidate so
    // it never lingers as an orphaned active, then resolve the actual winner.
    if (ownCandidateId) await this.#abandonOwnCandidate(ownCandidateId);
    const winner = await this.getActiveEnrollment(trackId);
    if (winner) return winner;
    throw new EnrollmentContentionError(trackId);
  }

  /**
   * Resolve the currently active enrollment for a track, or `null`.
   *
   * A pure two-step point read (slot → target). Returns the target ONLY if it
   * is `status:'active'` and its `trackId` matches — a terminal, absent, or
   * corrupted-trackId target reads as "not currently enrolled". Never a
   * `status` scan; never mutates.
   */
  async getActiveEnrollment(trackId: string): Promise<TrackEnrollment | null> {
    assertSafeSegment(trackId);
    const slot = await this.#store.get<ActiveSlot>(ENROLLMENTS, activeSlotId(trackId));
    if (!slot) return null;
    const enrollment = await this.#store.get<TrackEnrollment>(ENROLLMENTS, slot.enrollmentId);
    return enrollment?.status === 'active' && enrollment.trackId === trackId ? enrollment : null;
  }

  /**
   * Create or return the in-progress instance for a step, enforcing exactly one
   * instance per `(enrollmentId, stepId)` via a deterministic id + CAS create.
   *
   * A first call wins; a concurrent or repeated call observes a benign
   * {@link DocumentConflictError} and re-reads the existing instance.
   */
  async startStep(enrollmentId: string, stepId: string): Promise<TrackStepInstance> {
    assertSafeSegment(enrollmentId);
    assertSafeSegment(stepId);
    const id = stepInstanceId(enrollmentId, stepId);
    const now = this.#now();
    const instance: TrackStepInstance = {
      stepInstanceId: id,
      enrollmentId,
      stepId,
      status: 'in-progress',
      lastAccessedAt: now,
    };

    try {
      await this.#store.put(STEPS, id, instance, {
        ifNoneMatch: '*',
        metadata: { type: 'step-instance', status: 'in-progress', parentId: enrollmentId },
      });
      return instance;
    } catch (error) {
      if (!(error instanceof DocumentConflictError)) throw error;
      // Already started (concurrent or repeat). Re-read and return the existing.
      const existing = await this.#store.get<TrackStepInstance>(STEPS, id);
      if (!existing) throw new Error(`Step instance conflict but no instance found: ${id}`);
      return existing;
    }
  }

  /**
   * Best-effort re-stamp of a started step's `lastAccessedAt` (and, separately,
   * the enrollment's). Does NOT create an instance: an unstarted step is a
   * no-op, not an error. A concurrent status change wins on
   * {@link DocumentConflictError}; the stale stamp self-heals on next access.
   */
  async accessStep(enrollmentId: string, stepId: string): Promise<void> {
    assertSafeSegment(enrollmentId);
    assertSafeSegment(stepId);
    const id = stepInstanceId(enrollmentId, stepId);
    const envelope = await this.#store.getEnvelope<TrackStepInstance>(STEPS, id);
    if (!envelope) return; // nothing started yet → no-op

    const stamped: TrackStepInstance = { ...envelope.body, lastAccessedAt: this.#now() };
    try {
      await this.#store.put(STEPS, id, stamped, {
        ifMatch: envelope.etag,
        metadata: { type: 'step-instance', status: stamped.status, parentId: enrollmentId },
      });
    } catch (error) {
      if (!(error instanceof DocumentConflictError)) throw error;
      // A concurrent completeStep advanced the instance; the access-stamp yields.
    }

    await this.#touchEnrollment(enrollmentId);
  }

  /**
   * Mark a step completed. Ensures the instance exists (via {@link startStep}),
   * then CAS-advances its status to `'completed'` with a `completedAt` stamp,
   * retrying on conflict so a concurrent access-stamp cannot block completion.
   */
  async completeStep(enrollmentId: string, stepId: string): Promise<TrackStepInstance> {
    await this.startStep(enrollmentId, stepId);
    const id = stepInstanceId(enrollmentId, stepId);

    for (let attempt = 0; attempt < MAX_STEP_CAS_ATTEMPTS; attempt++) {
      const envelope = await this.#store.getEnvelope<TrackStepInstance>(STEPS, id);
      if (!envelope) throw new Error(`Step instance vanished before completion: ${id}`);
      if (envelope.body.status === 'completed') return envelope.body;

      const completed: TrackStepInstance = {
        ...envelope.body,
        status: 'completed',
        completedAt: this.#now(),
      };
      try {
        await this.#store.put(STEPS, id, completed, {
          ifMatch: envelope.etag,
          metadata: { type: 'step-instance', status: 'completed', parentId: enrollmentId },
        });
        return completed;
      } catch (error) {
        if (!(error instanceof DocumentConflictError)) throw error;
        // Lost a CAS race with a concurrent writer; re-read and retry.
      }
    }
    throw new EnrollmentContentionError(enrollmentId);
  }

  /** List every step instance for an enrollment (for current-step derivation). */
  async listStepInstances(enrollmentId: string): Promise<TrackStepInstance[]> {
    assertSafeSegment(enrollmentId);
    const result = await this.#store.list<TrackStepInstance>(STEPS, { parentId: enrollmentId });
    return result.items.map((envelope) => envelope.body);
  }

  /** Create a fresh active (but unslotted) enrollment; returns its id. */
  async #createEnrollment(trackId: string): Promise<string> {
    const enrollmentId = this.#newEnrollmentId();
    assertSafeSegment(enrollmentId);
    const now = this.#now();
    const enrollment: TrackEnrollment = {
      enrollmentId,
      trackId,
      catalogVersion: this.#catalogVersion,
      status: 'active',
      enrolledAt: now,
      lastAccessedAt: now,
    };
    await this.#store.put(ENROLLMENTS, enrollmentId, enrollment, {
      ifNoneMatch: '*',
      metadata: { type: 'enrollment', status: 'active', parentId: trackId },
    });
    return enrollmentId;
  }

  /**
   * Claim the active slot for our candidate: CAS-swap an existing slot off its
   * terminal/absent target, or create the slot on first enroll. Never removes.
   */
  async #claimSlot(slotId: string, enrollmentId: string, currentEtag: string | undefined): Promise<void> {
    const body: ActiveSlot = { enrollmentId };
    const guard = currentEtag ? { ifMatch: currentEtag } : { ifNoneMatch: '*' as const };
    await this.#store.put(ENROLLMENTS, slotId, body, { ...guard, metadata: { type: 'active-slot' } });
  }

  /**
   * Discard a candidate THIS call created after losing/exhausting/idempotently
   * returning: mark it `'abandoned'` and drop its step instances. Conflict-benign;
   * never touches a displaced enrollment or any slot.
   */
  async #abandonOwnCandidate(enrollmentId: string): Promise<void> {
    const envelope = await this.#store.getEnvelope<TrackEnrollment>(ENROLLMENTS, enrollmentId);
    if (envelope) {
      const abandoned: TrackEnrollment = { ...envelope.body, status: 'abandoned' };
      try {
        await this.#store.put(ENROLLMENTS, enrollmentId, abandoned, {
          ifMatch: envelope.etag,
          metadata: { type: 'enrollment', status: 'abandoned', parentId: abandoned.trackId },
        });
      } catch (error) {
        if (!(error instanceof DocumentConflictError)) throw error;
        // Someone else advanced our candidate; abandoning is best-effort.
      }
    }
    await this.#store.removeByParent(STEPS, enrollmentId);
  }

  /** Best-effort re-stamp of an enrollment's advisory `lastAccessedAt`. */
  async #touchEnrollment(enrollmentId: string): Promise<void> {
    const envelope = await this.#store.getEnvelope<TrackEnrollment>(ENROLLMENTS, enrollmentId);
    if (!envelope) return;
    const stamped: TrackEnrollment = { ...envelope.body, lastAccessedAt: this.#now() };
    try {
      await this.#store.put(ENROLLMENTS, enrollmentId, stamped, {
        ifMatch: envelope.etag,
        metadata: { type: 'enrollment', status: stamped.status, parentId: stamped.trackId },
      });
    } catch (error) {
      if (!(error instanceof DocumentConflictError)) throw error;
      // Advisory hint only; a concurrent write wins and staleness self-heals.
    }
  }
}
