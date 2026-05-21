'use client';

/**
 * Challenge Authoring Page
 *
 * Page route for creating custom challenges through guided AI conversation.
 *
 * @see SPEC-006 S1 for authoring page requirements
 */

import { AppHeader } from '@/components/AppHeader';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { DailyChallenge } from '@/lib/focus/types';
import { Banner, Spinner } from '@primer/react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import styles from '../challenge.module.css';

// Lazy-load ChallengeAuthoring (1005 lines across 5 files) to reduce /challenge/create
// initial JS bundle. The header, error banner, and hooks all load instantly; the heavy
// authoring UI streams in as a separate chunk.
const ChallengeAuthoring = dynamic(
  () => import('@/components/ChallengeAuthoring').then((mod) => mod.ChallengeAuthoring),
  { ssr: false, loading: () => <div className={styles.loading}><Spinner size="medium" /></div> }
);

/**
 * Challenge authoring page component.
 *
 * Provides the UI for creating custom challenges and adds them
 * to the custom challenge queue.
 */
export default function CreateChallengePage() {
  const router = useRouter();
  const { addChallenge, isQueueFull, maxQueueSize } = useCustomChallengeQueue(null);
  const { data: profile } = useUserProfile();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Register this page in breadcrumb history
  useBreadcrumb('/challenge/create', 'Create Challenge', '/challenge/create');

  /**
   * Handle saving a challenge to the queue.
   */
  const handleSaveChallenge = useCallback(
    async (challenge: DailyChallenge) => {
      if (isQueueFull) {
        setErrorMessage(
          `Queue is full (${maxQueueSize} challenges max). Complete or remove some challenges first.`
        );
        return;
      }

      const success = await addChallenge(challenge);
      if (success) {
        // Navigate back to dashboard with success indicator
        router.push('/?challengeAdded=1');
      } else {
        setErrorMessage('Failed to add challenge to queue. Please try again.');
        return;
      }
    },
    [addChallenge, isQueueFull, maxQueueSize, router]
  );

  return (
    <div className={styles.root}>
      <AppHeader />
      {errorMessage && (
        <Banner
          title="Error"
          description={errorMessage}
          variant="critical"
          onDismiss={() => setErrorMessage(null)}
        />
      )}

      <main className={styles.main}>
        <div className={styles.authoringWrapper}>
          <ChallengeAuthoring
            onSaveChallenge={handleSaveChallenge}
            userAvatarUrl={profile?.user?.avatarUrl}
          />
        </div>
      </main>
    </div>
  );
}
