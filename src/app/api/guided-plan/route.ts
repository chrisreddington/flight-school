import { parseJsonBodyWithFallback } from '@/lib/api';
import { generateGuidedPlan, getGuidedPlanFallback, type GuidedPlan } from '@/lib/copilot/guided-mode';
import { buildCompactContext, serializeContext } from '@/lib/github/profile';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';

const log = logger.withTag('Guided Plan API');

interface GuidedPlanRequestBody {
  challengeTitle: string;
  challengeDescription: string;
  challengeLanguage: string;
  challengeDifficulty: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<GuidedPlan>> {
  const body = await parseJsonBodyWithFallback<GuidedPlanRequestBody>(request, {
    challengeTitle: '',
    challengeDescription: '',
    challengeLanguage: '',
    challengeDifficulty: '',
  });

  const challenge = {
    title: body.challengeTitle?.trim() || 'Coding challenge',
    description: body.challengeDescription?.trim() || 'Implement a working solution.',
    language: body.challengeLanguage?.trim() || 'TypeScript',
    difficulty: body.challengeDifficulty?.trim() || 'beginner',
  };

  let profileContext = '';
  try {
    const compactContext = await buildCompactContext(1000);
    profileContext = serializeContext(compactContext);
  } catch (error) {
    log.warn('Failed to build profile context for guided plan', error);
  }

  try {
    const plan = await generateGuidedPlan(challenge, profileContext);
    return NextResponse.json(plan);
  } catch (error) {
    log.error('Failed to generate guided plan', error);
    return NextResponse.json(getGuidedPlanFallback(challenge));
  }
}
