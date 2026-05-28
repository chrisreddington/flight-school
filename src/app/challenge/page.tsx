/**
 * `/challenge` wrapper page.
 *
 * Server-resolves challenge specs from per-user storage using `?id=...`
 * and passes the hydrated challenge into a client island for the Monaco UI.
 */

import { notFound, redirect } from 'next/navigation';

import { readUserChallengeSpec } from '@/lib/challenge/spec-storage';
import type { ChallengeDef } from '@/lib/copilot/types';
import { requireGuardedRscContext } from '@/lib/security/guard';
import { SAFE_PATH_SEGMENT } from '@/lib/storage/user-scope';

import { ChallengePageClient } from './challenge-page-client';

interface ChallengePageProps {
  searchParams: Promise<{ id?: string | string[] }>;
}

function toChallengeDef(spec: NonNullable<Awaited<ReturnType<typeof readUserChallengeSpec>>>): ChallengeDef {
  return {
    title: spec.title,
    description: spec.description,
    type: spec.type,
    brokenCode: spec.brokenCode,
    language: spec.language,
    difficulty: spec.difficulty,
    testCases: [],
  };
}

export default async function ChallengePage({ searchParams }: ChallengePageProps) {
  const ctx = await requireGuardedRscContext('challenge.view');
  if (!ctx) redirect('/sign-in?callbackUrl=/challenge');

  const { id } = await searchParams;
  const challengeId = typeof id === 'string' ? id : null;
  if (!challengeId || !SAFE_PATH_SEGMENT.test(challengeId)) {
    notFound();
  }

  const challengeSpec = await readUserChallengeSpec(challengeId);
  if (!challengeSpec) {
    redirect('/');
  }

  return <ChallengePageClient challengeId={challengeId} challenge={toChallengeDef(challengeSpec)} />;
}
