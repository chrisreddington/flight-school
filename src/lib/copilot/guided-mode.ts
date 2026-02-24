import { extractJSON } from '@/lib/utils/json-utils';
import { createLoggedLightweightCoachSession } from './server';

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

interface RawGuidedPlan {
  steps?: Array<{
    stepNumber?: number;
    title?: string;
    instruction?: string;
    elaborationPrompt?: string;
  }>;
}

function scaffoldFromStep(stepNumber: number): ScaffoldLevel {
  if (stepNumber <= 1) return 'full';
  if (stepNumber === 2) return 'outline';
  return 'goal';
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

function normalizePlan(
  parsed: RawGuidedPlan | null,
  challenge: { title: string; description: string; language: string; difficulty: string }
): GuidedPlan {
  const fallback = getGuidedPlanFallback(challenge);
  if (!parsed?.steps || parsed.steps.length === 0) {
    return fallback;
  }

  const normalized = parsed.steps
    .slice(0, 4)
    .map((step, index): GuidedStep => {
      const stepNumber = Number.isFinite(step.stepNumber) ? Number(step.stepNumber) : index + 1;
      const fallbackStep = fallback.steps[Math.min(index, fallback.steps.length - 1)];

      return {
        stepNumber,
        title: step.title?.trim() || fallbackStep.title,
        instruction: step.instruction?.trim() || fallbackStep.instruction,
        scaffoldLevel: scaffoldFromStep(stepNumber),
        elaborationPrompt: step.elaborationPrompt?.trim() || fallbackStep.elaborationPrompt,
      };
    })
    .sort((a, b) => a.stepNumber - b.stepNumber);

  if (normalized.length < 3) {
    return fallback;
  }

  return {
    steps: normalized,
    totalSteps: normalized.length,
  };
}

export async function generateGuidedPlan(
  challenge: { title: string; description: string; language: string; difficulty: string },
  profileContext: string
): Promise<GuidedPlan> {
  const prompt = `Challenge: ${challenge.title} (${challenge.language}, ${challenge.difficulty})
Description: ${challenge.description}
Profile: ${profileContext}

Break this into 3 concise, actionable steps for a guided learning mode.
Each instruction must be 1-3 sentences of plain guidance — no code templates or file listings.
Step 1: orient thinking and identify key inputs/outputs. Step 2: prompt planning/outlining. Step 3: focus on goal and verification.

JSON only:
{"steps":[{"stepNumber":1,"title":"","instruction":"","elaborationPrompt":"Why does this approach work here?"}]}`;

  const loggedSession = await createLoggedLightweightCoachSession('Guided Challenge Plan', challenge.title);

  try {
    const result = await loggedSession.sendAndWait(prompt);
    const parsed = extractJSON<RawGuidedPlan>(result.responseText, 'Guided Challenge Plan');
    return normalizePlan(parsed, challenge);
  } catch {
    return getGuidedPlanFallback(challenge);
  } finally {
    loggedSession.destroy();
  }
}
