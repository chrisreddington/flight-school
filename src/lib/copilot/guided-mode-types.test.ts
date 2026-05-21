/**
 * Guided Mode Types Tests
 *
 * Tests for getGuidedPlanFallback — the pure fallback generator for guided plans.
 * No server imports; safe to run in jsdom.
 */

import { describe, expect, it } from 'vitest';
import { getGuidedPlanFallback, type GuidedPlan, type ScaffoldLevel } from './guided-mode-types';

// =============================================================================
// Test Fixtures
// =============================================================================

const baseChallenge = {
  title: 'FizzBuzz',
  description: 'Print Fizz for multiples of 3 and Buzz for multiples of 5.',
  language: 'TypeScript',
  difficulty: 'beginner',
};

// =============================================================================
// getGuidedPlanFallback Tests
// =============================================================================

describe('getGuidedPlanFallback', () => {
  it('should return exactly 3 steps', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps).toHaveLength(3);
  });

  it('should set totalSteps to 3', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.totalSteps).toBe(3);
  });

  it('should number steps 1, 2, 3 in order', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
  });

  it('should assign scaffold levels full → outline → goal', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    const levels: ScaffoldLevel[] = plan.steps.map((s) => s.scaffoldLevel);
    expect(levels).toEqual(['full', 'outline', 'goal']);
  });

  it('should include the challenge language in step 1 instruction', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[0].instruction).toContain('TypeScript');
  });

  it('should include the challenge difficulty in step 3 instruction', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[2].instruction).toContain('beginner');
  });

  it('should include challenge title in step 1 title', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[0].title).toContain('FizzBuzz');
  });

  it('should populate elaborationPrompt on all steps', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    for (const step of plan.steps) {
      expect(step.elaborationPrompt.length).toBeGreaterThan(0);
    }
  });

  it('should return distinct plans for different challenge inputs', () => {
    const plan1 = getGuidedPlanFallback({ ...baseChallenge, title: 'Fibonacci', language: 'Python', difficulty: 'intermediate' });
    const plan2 = getGuidedPlanFallback(baseChallenge);

    expect(plan1.steps[0].instruction).toContain('Python');
    expect(plan2.steps[0].instruction).toContain('TypeScript');
  });

  it('should return a plan matching the GuidedPlan shape', () => {
    const plan: GuidedPlan = getGuidedPlanFallback(baseChallenge);
    expect(plan).toMatchObject({
      steps: expect.any(Array),
      totalSteps: expect.any(Number),
    });
    for (const step of plan.steps) {
      expect(step).toMatchObject({
        stepNumber: expect.any(Number),
        title: expect.any(String),
        instruction: expect.any(String),
        scaffoldLevel: expect.stringMatching(/^(full|outline|goal)$/),
        elaborationPrompt: expect.any(String),
      });
    }
  });

  it.each([
    ['JavaScript', 'advanced'],
    ['Python', 'intermediate'],
    ['Go', 'beginner'],
  ])('should embed language=%s and difficulty=%s into step instructions', (language, difficulty) => {
    const plan = getGuidedPlanFallback({ ...baseChallenge, language, difficulty });
    const allInstructions = plan.steps.map((s) => s.instruction).join(' ');
    expect(allInstructions).toContain(language);
    expect(allInstructions).toContain(difficulty);
  });
});
