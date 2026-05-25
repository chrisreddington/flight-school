'use client';

/**
 * Challenge Page
 *
 * Reads challenge details from URL search params and renders the full-page
 * sandbox experience. Param parsing + Monaco preload live in
 * {@link ./challenge-page-helpers}.
 */

import { useSearchParams } from 'next/navigation';
import { lazy, Suspense, useCallback, useMemo } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { focusStore } from '@/lib/focus';
import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';

import { parseChallengeFromSearchParams, useMonacoPreload } from './challenge-page-helpers';
import styles from './challenge.module.css';

const log = logger.withTag('ChallengePage');

// PERF: Code split ChallengeSandbox (includes Monaco Editor ~200KB)
const ChallengeSandbox = lazy(() =>
  import('@/components/ChallengeSandbox').then((mod) => ({ default: mod.ChallengeSandbox })),
);

function ChallengePageContent() {
  const searchParams = useSearchParams();

  useMonacoPreload();

  const { challengeId, challenge } = useMemo(() => parseChallengeFromSearchParams(searchParams), [searchParams]);

  // Memoise the breadcrumb href so unrelated re-renders don't re-register it.
  const breadcrumbHref = useMemo(() => {
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => params.set(key, value));
    return `/challenge?${params.toString()}`;
  }, [searchParams]);

  useBreadcrumb('/challenge', challenge.title, breadcrumbHref);

  const handleComplete = useCallback(async () => {
    try {
      const dateKey = getDateKey();
      log.info('Marking challenge as completed', { challengeId, dateKey });

      // Custom challenges generated on-the-fly are passed via URL params and
      // are not pre-loaded into the daily history, so transitionChallenge would
      // fail with "not found". addChallenge is idempotent — safe to call always.
      await focusStore.addChallenge(dateKey, {
        id: challengeId,
        title: challenge.title,
        description: challenge.description,
        type: challenge.type,
        brokenCode: challenge.brokenCode,
        difficulty: challenge.difficulty,
        language: challenge.language ?? 'TypeScript',
        estimatedTime: '30 minutes',
        whyThisChallenge: [],
        isCustom: challengeId.startsWith('custom-'),
      });

      await focusStore.transitionChallenge(dateKey, challengeId, 'completed', 'challenge-sandbox');
      log.info('Challenge marked as completed', { challengeId, dateKey });
    } catch (error) {
      log.error('Failed to mark challenge as completed', { challengeId, error });
    }
  }, [challengeId, challenge]);

  return (
    <div className={styles.root}>
      <AppHeader />
      <main className={styles.main}>
        <ChallengeSandbox challengeId={challengeId} challenge={challenge} onComplete={handleComplete} autoFocus />
      </main>
    </div>
  );
}

function ChallengePageLoading() {
  return (
    <div className={styles.root}>
      <AppHeader />
      <div className={styles.loading}>Loading challenge...</div>
    </div>
  );
}

export default function ChallengePage() {
  return (
    <Suspense fallback={<ChallengePageLoading />}>
      <ChallengePageContent />
    </Suspense>
  );
}
