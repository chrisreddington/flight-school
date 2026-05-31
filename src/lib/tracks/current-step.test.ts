import { describe, expect, it } from 'vitest';

import { deriveCurrentStep } from './current-step';
import type { TrackStep, TrackStepInstance } from './types';

const catalogSteps: readonly TrackStep[] = [
  { stepId: 'a', title: 'A', summary: 'first' },
  { stepId: 'b', title: 'B', summary: 'second' },
  { stepId: 'c', title: 'C', summary: 'third' },
];

function instance(stepId: string, status: TrackStepInstance['status'], lastAccessedAt?: string): TrackStepInstance {
  return { stepInstanceId: `step-${stepId}`, enrollmentId: 'enr', stepId, status, lastAccessedAt };
}

describe('deriveCurrentStep', () => {
  it('(a) returns the first catalog step when there are no instances', () => {
    expect(deriveCurrentStep(catalogSteps, [])).toBe(catalogSteps[0]);
  });

  it('(b) returns the most-recently-accessed incomplete step', () => {
    const instances = [
      instance('a', 'completed'),
      instance('b', 'in-progress', '2026-05-01T10:00:00.000Z'),
      instance('c', 'in-progress', '2026-05-01T12:00:00.000Z'),
    ];
    expect(deriveCurrentStep(catalogSteps, instances)?.stepId).toBe('c');
  });

  it('(c) returns null when every catalog step is completed', () => {
    const instances = [instance('a', 'completed'), instance('b', 'completed'), instance('c', 'completed')];
    expect(deriveCurrentStep(catalogSteps, instances)).toBeNull();
  });

  it('(d) falls back to the lowest-ordered incomplete step when none were accessed', () => {
    const instances = [instance('a', 'completed')];
    // b and c are not-started (no instance); lowest-ordered incomplete is b.
    expect(deriveCurrentStep(catalogSteps, instances)?.stepId).toBe('b');
  });

  it('prefers an accessed incomplete step over a lower-ordered unaccessed one', () => {
    const instances = [instance('c', 'in-progress', '2026-05-01T09:00:00.000Z')];
    // a and b are unaccessed/not-started, but c was explicitly accessed.
    expect(deriveCurrentStep(catalogSteps, instances)?.stepId).toBe('c');
  });

  it('ignores instances whose stepId is no longer in the catalog', () => {
    const instances = [instance('a', 'completed'), instance('removed-step', 'in-progress', '2026-05-01T23:00:00.000Z')];
    // The orphaned instance must not be returned; lowest-ordered incomplete is b.
    expect(deriveCurrentStep(catalogSteps, instances)?.stepId).toBe('b');
  });

  it('returns null for an empty catalog', () => {
    expect(deriveCurrentStep([], [])).toBeNull();
  });
});
