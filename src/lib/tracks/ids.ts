/**
 * Deterministic id helpers for the Tracks data layer (§B.1).
 *
 * Every id this module produces is either validated against the safe-segment
 * class or derived from a hash of validated inputs, so a track/step id can
 * never traverse out of its storage partition. The repo relies on the
 * *determinism* of {@link stepInstanceId} (and the absence of any sqlite
 * uniqueness index) to achieve one-instance-per-(enrollment, step) purely
 * through `put(ifNoneMatch:'*')` CAS — keeping the repo backend-portable.
 *
 * This module imports only `node:crypto` and the dependency-free safe-segment
 * class, so it never drags storage-adapter or `server-only` code into the
 * backend-portable repo's import graph.
 *
 * @module tracks/ids
 */

import { createHash } from 'node:crypto';

import { SAFE_PATH_SEGMENT } from '../storage/safe-segment';

/**
 * Throw unless `segment` is a safe storage path segment.
 *
 * @throws {Error} when `segment` contains anything outside the safe class
 *   (e.g. `/`, `..`, `.`), which would let a crafted id escape its partition.
 */
export function assertSafeSegment(segment: string): void {
  if (!SAFE_PATH_SEGMENT.test(segment)) {
    throw new Error(`Refusing unsafe tracks path segment: ${JSON.stringify(segment)}`);
  }
}

/**
 * The slot key for a track — the validated `trackId` itself. Centralised so
 * the slot-id derivation has a single, validated source.
 *
 * @throws {Error} when `trackId` fails {@link assertSafeSegment}.
 */
export function slotKey(trackId: string): string {
  assertSafeSegment(trackId);
  return trackId;
}

/**
 * The document id of a track's active-slot pointer in `track-enrollments`.
 * The `active-` prefix keeps slot pointers in a distinct id namespace from
 * the enrollment documents they point at.
 *
 * @throws {Error} when `trackId` fails {@link assertSafeSegment}.
 */
export function activeSlotId(trackId: string): string {
  return `active-${slotKey(trackId)}`;
}

/**
 * The deterministic document id for a `(enrollmentId, stepId)` step instance.
 *
 * Fields are joined with a NUL separator before hashing so distinct field
 * splits (e.g. `('ab','c')` vs `('a','bc')`) can never collide. The hash makes
 * the id a fixed-length safe segment regardless of the inputs, and its
 * determinism is what lets a `put(ifNoneMatch:'*')` create enforce exactly one
 * instance per pair.
 */
export function stepInstanceId(enrollmentId: string, stepId: string): string {
  const digest = createHash('sha256').update(`${enrollmentId}\u0000${stepId}`).digest('hex');
  return `step-${digest}`;
}
