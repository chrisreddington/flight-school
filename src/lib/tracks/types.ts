/**
 * Domain types for the Tracks continuous-learning feature (§B.1).
 *
 * Two distinct shapes live here:
 *
 * - **Catalog types** ({@link Track}, {@link TrackStep}) describe the *static,
 *   curated* course content — the same for every user, versioned by
 *   {@link Catalog.catalogVersion}, shipped as a TS module rather than stored
 *   per user.
 * - **Per-user types** ({@link TrackEnrollment}, {@link TrackStepInstance})
 *   describe a single learner's *progress* against that catalog, persisted in
 *   the `track-enrollments` and `track-steps` document-store containers.
 *
 * Keeping both in one pure module (no storage, no `server-only`) lets the
 * backend-portable repo and the React/RSC layer share one vocabulary.
 *
 * @module tracks/types
 */

/** A single ordered step within a {@link Track}. */
export interface TrackStep {
  /**
   * Stable, catalog-unique step identifier. Validated against the safe-segment
   * class at catalog load, so it is always usable as a storage path segment.
   */
  stepId: string;
  /** Human-readable step title shown in the UI. */
  title: string;
  /** One- or two-sentence summary of what the learner does in this step. */
  summary: string;
}

/** A curated learning track: an ordered sequence of {@link TrackStep}s. */
export interface Track {
  /**
   * Stable, catalog-unique track identifier. Doubles as the slot key, so it is
   * validated against the safe-segment class at catalog load.
   */
  trackId: string;
  /** Human-readable track title. */
  title: string;
  /** Short description of the track's goal and audience. */
  description: string;
  /** The ordered steps; array order IS the canonical step order. */
  steps: readonly TrackStep[];
}

/** The whole curated catalog, versioned so progress can detect drift. */
export interface Catalog {
  /**
   * Opaque version string bumped whenever the curated content changes. Stamped
   * onto every {@link TrackEnrollment} so a learner's progress records which
   * catalog revision they enrolled against.
   */
  catalogVersion: string;
  /** Every track in the catalog. */
  tracks: readonly Track[];
}

/** Lifecycle status of a {@link TrackEnrollment}. */
export type EnrollmentStatus = 'active' | 'completed' | 'abandoned';

/**
 * One learner's enrollment in one track.
 *
 * `status` is **advisory / history only** — it records how an enrollment
 * ended, never which enrollment is "current". Currency is owned exclusively by
 * the active-slot document (see the repo). An `'abandoned'`/`'completed'`
 * enrollment keeps its record (and its `track-steps`) for history; it is never
 * pruned on re-enroll.
 */
export interface TrackEnrollment {
  /** Stable, repo-generated enrollment id; the document id in `track-enrollments`. */
  enrollmentId: string;
  /** The {@link Track.trackId} this enrollment is for. */
  trackId: string;
  /** The {@link Catalog.catalogVersion} in force when the learner enrolled. */
  catalogVersion: string;
  /** Advisory lifecycle status; NEVER gates "is this the active enrollment". */
  status: EnrollmentStatus;
  /**
   * Immutable creation timestamp (ISO 8601), set once at creation and never
   * mutated. The reconciliation sweep's grace check reads THIS, not the
   * envelope's `updatedAt` (which advances on every write).
   */
  enrolledAt: string;
  /** Best-effort "last opened" timestamp (ISO 8601); advisory, may lag. */
  lastAccessedAt: string;
}

/** Lifecycle status of a {@link TrackStepInstance}. */
type StepInstanceStatus = 'not-started' | 'in-progress' | 'completed';

/**
 * One learner's progress on one step of one enrollment.
 *
 * The document id is a deterministic hash of `(enrollmentId, stepId)`, so a
 * `put(ifNoneMatch:'*')` create yields exactly one instance per
 * `(enrollment, step)` pair without a uniqueness index. Queries always
 * `list(parentId=enrollmentId)` and match `stepId` in memory — the composite
 * id is never parsed.
 */
export interface TrackStepInstance {
  /** Deterministic `step-${sha256(enrollmentId + NUL + stepId)}` document id. */
  stepInstanceId: string;
  /** The owning {@link TrackEnrollment.enrollmentId}; also the document parentId. */
  enrollmentId: string;
  /** The {@link TrackStep.stepId} this instance tracks. */
  stepId: string;
  /** Progress status for this step. */
  status: StepInstanceStatus;
  /** ISO 8601 completion timestamp; present only once `status === 'completed'`. */
  completedAt?: string;
  /** Best-effort "last opened" timestamp (ISO 8601); advisory, may lag. */
  lastAccessedAt?: string;
}

/**
 * Thrown by `enroll()` only in the pathological case where three CAS attempts
 * all lost the active-slot race yet no active enrollment resolves afterwards —
 * i.e. sustained adversarial contention, not a normal concurrent enroll (which
 * resolves to the winning enrollment). Distinct from a storage conflict so the
 * caller can surface "try again" rather than a generic error.
 */
export class EnrollmentContentionError extends Error {
  readonly code = 'ENROLLMENT_CONTENTION';

  constructor(trackId: string) {
    super(`Could not resolve an active enrollment for track after retries: ${trackId}`);
    this.name = 'EnrollmentContentionError';
  }
}

/**
 * Thrown by a step mutation ({@link TrackStepInstance} transition) when its CAS
 * loop exhausts every retry against a concurrent writer. Distinct from
 * {@link EnrollmentContentionError} — that names a *track* whose active slot
 * could not be resolved; this names the *step instance* whose status could not
 * be advanced — so the caller can tell "re-enroll" apart from "retry this step".
 */
export class StepContentionError extends Error {
  readonly code = 'STEP_CONTENTION';

  constructor(stepInstanceId: string) {
    super(`Could not advance step instance after retries: ${stepInstanceId}`);
    this.name = 'StepContentionError';
  }
}

/**
 * Thrown by a step mutation when the enrollment it targets is not the track's
 * current, active enrollment. Covers three cases that all mean "this progress
 * write would land on a stale or non-existent enrollment": the enrollment
 * document is absent, its `status` is not `'active'`, or it IS active but the
 * track's active slot points at a different (rival) enrollment — i.e. it has
 * been displaced. Step methods validate currency at call time so a client
 * holding a stale `enrollmentId` cannot silently mutate history.
 */
export class EnrollmentNotActiveError extends Error {
  readonly code = 'ENROLLMENT_NOT_ACTIVE';

  constructor(enrollmentId: string) {
    super(`Enrollment is not the active enrollment for its track: ${enrollmentId}`);
    this.name = 'EnrollmentNotActiveError';
  }
}
