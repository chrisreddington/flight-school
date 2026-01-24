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
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
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

  // Register this page in breadcrumb history
  useBreadcrumb('/challenge/create', 'Create Challenge', '/challenge/create');

  /**
   * Handle saving a challenge to the queue.
   */
  const handleSaveChallenge = useCallback(
    (challenge: DailyChallenge) => {
      if (isQueueFull) {
        // Show error - queue is full
        alert(`Queue is full (${maxQueueSize} challenges max). Complete or remove some challenges first.`);
        return;
      }

      const success = addChallenge(challenge);
      if (success) {
        // Navigate back to dashboard
        router.push('/');
      } else {
        alert('Failed to add challenge to queue. Please try again.');
      }
    },
    [addChallenge, isQueueFull, maxQueueSize, router]
  );

  return (
    <div className={styles.root}>
      <AppHeader />

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
