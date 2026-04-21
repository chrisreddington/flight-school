/**
 * Tests for guided-mode-types: GuidedPlan fallback factory and type contracts.
 *
 * getGuidedPlanFallback is a pure function with no external dependencies,
 * making it ideal for thorough unit coverage.
 */

import { describe, it, expect } from 'vitest';
import { getGuidedPlanFallback } from './guided-mode-types';
import type { GuidedPlan, GuidedStep, ScaffoldLevel } from './guided-mode-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseChallenge = {
  title: 'FizzBuzz',
  description: 'Print numbers 1-100, replacing multiples of 3 with Fizz, etc.',
  language: 'TypeScript',
  difficulty: 'beginner',
};

// ---------------------------------------------------------------------------
// getGuidedPlanFallback — structure tests
// ---------------------------------------------------------------------------

describe('getGuidedPlanFallback', () => {
  it('should return a plan with exactly 3 steps', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps).toHaveLength(3);
    expect(plan.totalSteps).toBe(3);
  });

  it('should number steps 1, 2, 3', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    const numbers = plan.steps.map((s) => s.stepNumber);
    expect(numbers).toEqual([1, 2, 3]);
  });

  it('should assign scaffold levels full → outline → goal', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    const levels: ScaffoldLevel[] = plan.steps.map((s) => s.scaffoldLevel);
    expect(levels).toEqual(['full', 'outline', 'goal']);
  });

  it('should include non-empty title for each step', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    for (const step of plan.steps) {
      expect(step.title.length).toBeGreaterThan(0);
    }
  });

  it('should include non-empty instruction for each step', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    for (const step of plan.steps) {
      expect(step.instruction.length).toBeGreaterThan(0);
    }
  });

  it('should include non-empty elaborationPrompt for each step', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    for (const step of plan.steps) {
      expect(step.elaborationPrompt.length).toBeGreaterThan(0);
    }
  });

  it('should embed challenge title in step 1 title', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[0].title).toContain('FizzBuzz');
  });

  it('should embed language in step 1 instruction', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[0].instruction).toContain('TypeScript');
  });

  it('should embed difficulty in step 3 instruction', () => {
    const plan = getGuidedPlanFallback(baseChallenge);
    expect(plan.steps[2].instruction).toContain('beginner');
  });

  it('should satisfy the GuidedPlan and GuidedStep type shape', () => {
    const plan: GuidedPlan = getGuidedPlanFallback(baseChallenge);
    expect(typeof plan.totalSteps).toBe('number');

    for (const step of plan.steps) {
      const s: GuidedStep = step;
      expect(typeof s.stepNumber).toBe('number');
      expect(typeof s.title).toBe('string');
      expect(typeof s.instruction).toBe('string');
      expect(typeof s.elaborationPrompt).toBe('string');
      expect(['full', 'outline', 'goal']).toContain(s.scaffoldLevel);
    }
  });
});

// ---------------------------------------------------------------------------
// getGuidedPlanFallback — different challenge configurations
// ---------------------------------------------------------------------------

describe('getGuidedPlanFallback with varied inputs', () => {
  it.each([
    ['Reverse String', 'Python', 'intermediate'],
    ['Binary Search', 'Java', 'advanced'],
    ['Hello World', 'Go', 'beginner'],
  ])('should produce 3 steps for %s in %s (%s)', (title, language, difficulty) => {
    const plan = getGuidedPlanFallback({
      title,
      description: 'A challenge.',
      language,
      difficulty,
    });
    expect(plan.steps).toHaveLength(3);
    expect(plan.totalSteps).toBe(3);
    expect(plan.steps[0].instruction).toContain(language);
    expect(plan.steps[2].instruction).toContain(difficulty);
  });

  it('should handle a challenge with an empty description', () => {
    const plan = getGuidedPlanFallback({
      title: 'Empty Desc',
      description: '',
      language: 'Rust',
      difficulty: 'advanced',
    });
    expect(plan.steps).toHaveLength(3);
  });
});
