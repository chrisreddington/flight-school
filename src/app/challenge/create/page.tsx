'use client';

/**
 * Challenge Authoring Page
 *
 * Page route for creating custom challenges through guided AI conversation.
 *
 * @see SPEC-006 S1 for authoring page requirements
 */

import { AppHeader } from '@/components/AppHeader';
import { ChallengeAuthoring } from '@/components/ChallengeAuthoring';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import { useUserProfile } from '@/hooks/use-user-profile';
import type { DailyChallenge } from '@/lib/focus/types';
import { Banner } from '@primer/react';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import styles from '../challenge.module.css';

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
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChallengeAuthoring
            onSaveChallenge={handleSaveChallenge}
            userAvatarUrl={profile?.user?.avatarUrl}
          />
        </div>
      </main>
    </div>
  );
}
