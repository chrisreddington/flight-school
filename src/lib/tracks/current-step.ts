/**
 * Pure derivation of a learner's "current step" within a track (§B.1, §B.4).
 *
 * The current step is *computed*, never stored: there is no `lastCompleted + 1`
 * pointer that could drift out of sync with the per-step instances. Given the
 * catalog's ordered steps and whatever step instances exist, the rule is:
 *
 * 1. Consider only *incomplete* steps (no instance, or an instance whose status
 *    is not `'completed'`).
 * 2. Among those, prefer the one most recently touched — the largest
 *    `lastAccessedAt` — so "resume" lands where the learner last was.
 * 3. If no incomplete step was ever accessed, fall back to the lowest-ordered
 *    incomplete step (catalog order).
 * 4. If every catalog step is completed, return `null`.
 *
 * Instances whose `stepId` is no longer in the catalog (content was removed
 * after enrollment) are ignored — they can never be the current step.
 *
 * Pure module: types only, no storage, no clock.
 *
 * @module tracks/current-step
 */

import type { TrackStep, TrackStepInstance } from './types';

/**
 * Derive the step a learner should resume on, or `null` if the track is fully
 * complete or empty.
 *
 * @param catalogSteps - The track's steps in canonical order.
 * @param stepInstances - The learner's instances for this enrollment (any
 *   order; instances for unknown steps are tolerated and ignored).
 */
export function deriveCurrentStep(
  catalogSteps: readonly TrackStep[],
  stepInstances: readonly TrackStepInstance[],
): TrackStep | null {
  const instancesByStepId = new Map<string, TrackStepInstance>();
  for (const instance of stepInstances) {
    instancesByStepId.set(instance.stepId, instance);
  }

  const incompleteSteps = catalogSteps.filter((step) => {
    const instance = instancesByStepId.get(step.stepId);
    return instance?.status !== 'completed';
  });

  if (incompleteSteps.length === 0) {
    return null;
  }

  const mostRecentlyAccessed = pickMostRecentlyAccessed(incompleteSteps, instancesByStepId);
  return mostRecentlyAccessed ?? incompleteSteps[0];
}

/**
 * Return the incomplete step with the largest `lastAccessedAt`, or `null` when
 * none of the incomplete steps has ever been accessed.
 */
function pickMostRecentlyAccessed(
  incompleteSteps: readonly TrackStep[],
  instancesByStepId: ReadonlyMap<string, TrackStepInstance>,
): TrackStep | null {
  let best: TrackStep | null = null;
  let bestAccessedAt = '';

  for (const step of incompleteSteps) {
    const accessedAt = instancesByStepId.get(step.stepId)?.lastAccessedAt;
    if (accessedAt && accessedAt > bestAccessedAt) {
      best = step;
      bestAccessedAt = accessedAt;
    }
  }

  return best;
}
