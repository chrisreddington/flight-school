/** Client-safe types and fallback logic for guided mode. No server imports. */

export type ScaffoldLevel = 'full' | 'outline' | 'goal';

export interface GuidedStep {
  stepNumber: number;
  title: string;
  instruction: string;
  scaffoldLevel: ScaffoldLevel;
  elaborationPrompt: string;
}

export interface GuidedPlan {
  steps: GuidedStep[];
  totalSteps: number;
}

export function getGuidedPlanFallback(
  challenge: { title: string; description: string; language: string; difficulty: string }
): GuidedPlan {
  const steps: GuidedStep[] = [
    {
      stepNumber: 1,
      title: `Understand the ${challenge.title} requirements`,
      instruction: `Read the prompt closely and list the key inputs, expected output, and one edge case you should handle in ${challenge.language}.`,
      scaffoldLevel: 'full',
      elaborationPrompt: 'Why does clarifying inputs and outputs first reduce implementation mistakes?',
    },
    {
      stepNumber: 2,
      title: 'Outline your solution approach',
      instruction: `Write a short plan (2-3 bullets) for your solution logic, then map each bullet to a small code step before coding.`,
      scaffoldLevel: 'outline',
      elaborationPrompt: 'Why does planning in small chunks make debugging easier?',
    },
    {
      stepNumber: 3,
      title: 'Implement and verify independently',
      instruction: `Implement your solution and test it with at least one normal case and one edge case for this ${challenge.difficulty} challenge.`,
      scaffoldLevel: 'goal',
      elaborationPrompt: 'Why do targeted test cases confirm your reasoning, not just your syntax?',
    },
  ];

  return { steps, totalSteps: steps.length };
}
