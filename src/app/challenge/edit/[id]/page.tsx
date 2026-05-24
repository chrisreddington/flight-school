'use client';

/**
 * Edit Custom Challenge Page
 *
 * Loads the challenge by id, gates editing to custom-only entries, and
 * delegates form rendering + submission to {@link EditChallengeForm}.
 */

import { Banner, Button, Spinner } from '@primer/react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { EditChallengeForm } from '@/components/EditChallengeForm';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import type { DailyChallenge } from '@/lib/focus/types';

import styles from '../../challenge.module.css';

export default function EditChallengePage() {
  const params = useParams();
  const router = useRouter();
  const challengeId = params.id as string;

  const { getById, updateChallenge } = useCustomChallengeQueue(null);

  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useBreadcrumb(`/challenge/edit/${challengeId}`, 'Edit Challenge', `/challenge/edit/${challengeId}`);

  useEffect(() => {
    (async () => {
      const loaded = await getById(challengeId);
      if (loaded) setChallenge(loaded);
      setIsLoading(false);
    })();
  }, [challengeId, getById]);

  const handleSave = useCallback(
    async (updated: DailyChallenge) => {
      const success = await updateChallenge(challengeId, updated);
      if (success) {
        router.push('/');
        return { success: true };
      }
      return {
        success: false,
        error: 'Failed to save changes. The challenge may no longer exist.',
      };
    },
    [updateChallenge, challengeId, router]
  );

  const handleCancel = useCallback(() => router.back(), [router]);

  if (isLoading) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <div className={styles.editLoadingCenter}>
            <Spinner size="medium" />
          </div>
        </main>
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <Banner variant="critical" title="Challenge not found">
            This challenge doesn&apos;t exist or has already been completed.
          </Banner>
          <Button onClick={() => router.push('/')} className={styles.editActionTop}>
            Back to Dashboard
          </Button>
        </main>
      </div>
    );
  }

  if (!challenge.isCustom) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <Banner variant="warning" title="Cannot edit this challenge">
            Only custom challenges can be edited. AI-generated daily challenges cannot be modified.
          </Banner>
          <Button onClick={() => router.push('/')} className={styles.editActionTop}>
            Back to Dashboard
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <AppHeader />
      <main className={styles.main}>
        <EditChallengeForm
          initialChallenge={challenge}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </main>
    </div>
  );
}
