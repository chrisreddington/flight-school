'use client';

/**
 * Client island for the `/challenge` page.
 *
 * Owns Monaco preload, breadcrumb registration, and completion side effects.
 */

import { lazy, Suspense, useCallback } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { focusStore } from '@/lib/focus';
import type { ChallengeDef } from '@/lib/copilot/types';
import { logger } from '@/lib/logger';
import { getDateKey } from '@/lib/utils/date-utils';

import { useMonacoPreload } from './challenge-page-helpers';
import styles from './challenge.module.css';

const log = logger.withTag('ChallengePage');

const ChallengeSandbox = lazy(() =>
  import('@/components/ChallengeSandbox').then((mod) => ({ default: mod.ChallengeSandbox })),
);

interface ChallengePageClientProps {
  challengeId: string;
  challenge: ChallengeDef;
}

export function ChallengePageClient({ challengeId, challenge }: ChallengePageClientProps) {
  useMonacoPreload();

  useBreadcrumb('/challenge', challenge.title, `/challenge?id=${encodeURIComponent(challengeId)}`);

  const handleComplete = useCallback(async () => {
    try {
      const dateKey = getDateKey();
      log.info('Marking challenge as completed', { challengeId, dateKey });

      await focusStore.addChallenge(dateKey, {
        id: challengeId,
        title: challenge.title,
        description: challenge.description,
        type: challenge.type,
        brokenCode: challenge.brokenCode,
        difficulty: challenge.difficulty,
        language: challenge.language ?? 'TypeScript',
        estimatedTime: challenge.estimatedTime ?? '30 minutes',
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
        <Suspense fallback={<div className={styles.loading}>Loading challenge...</div>}>
          <ChallengeSandbox challengeId={challengeId} challenge={challenge} onComplete={handleComplete} autoFocus />
        </Suspense>
      </main>
    </div>
  );
}
