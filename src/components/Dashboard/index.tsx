'use client';

/**
 * Flight School Dashboard
 *
 * A polished, GitHub-inspired interface for AI-powered developer learning.
 * Built with Primer React components following modern GitHub design patterns.
 *
 * Reads as a true overview: the full learning chat now lives on the
 * dedicated `/chat` surface, and the dashboard only links into it via the
 * compact ContinueLearningSection.
 *
 * Features:
 * - Dynamic user profile from GitHub API
 * - Daily Focus tabs (Challenge, Goal, Learn)
 * - Compact "Continue learning" entry point to /chat
 * - Real-time GitHub activity stats
 */

import { useActiveOperations } from '@/hooks/use-active-operations';
import { useAIFocus } from '@/hooks/use-ai-focus';
import { useHasMounted } from '@/hooks/use-has-mounted';
import { useLearningChat } from '@/hooks/use-learning-chat';
import { getDisplayName, useUserProfile } from '@/hooks/use-user-profile';
import type { LearningTopic } from '@/lib/focus/types';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonBox, SplitPageLayout, Stack } from '@primer/react';
import { useRouter } from 'next/navigation';
import { AppHeader } from '../AppHeader';
import { ContinueLearningSection } from './continue-learning-section';
import { DailyFocusSection } from './daily-focus-section';
import { getGreeting } from './dashboard-helpers';
import styles from './Dashboard.module.css';
import { Footer } from './footer';
import { ProTipSection } from './pro-tip-section';
import { ProfileActivitySection } from './profile-activity-section';
import { ReviewDueWidget } from './review-due-widget';

// ============================================================================
// Main Component
// ============================================================================

export function Dashboard() {
  // Initialize operations manager on mount (ensures cross-page state sync)
  useActiveOperations();
  const router = useRouter();

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useUserProfile();
  const {
    data: aiFocus,
    isAIEnabled,
    toolsUsed,
    refetch: refetchFocus,
    regenerateChallenge,
    loadingComponents,
    skipAndReplaceTopic,
    skipAndReplaceChallenge,
    requestDebugChallenge,
    skipAndReplaceGoal,
    skippingTopicIds,
    skippingChallengeIds,
    skippingGoalIds,
    stopComponent,
    stopTopicSkip,
    stopChallengeSkip,
    stopGoalSkip,
  } = useAIFocus();

  // Adapter for DailyFocusSection which expects string[] format
  const handleRefresh = (components?: string[]) => {
    const component = components?.[0] as 'challenge' | 'goal' | 'learningTopics' | undefined;
    refetchFocus(component);
  };

  // Handle skipping a single topic and generating a replacement
  const handleSkipTopic = (skippedTopic: LearningTopic, existingTopicTitles: string[]) => {
    skipAndReplaceTopic(skippedTopic.id, existingTopicTitles);
  };

  // Handle skipping a challenge and generating a replacement
  const handleSkipChallenge = (challengeId: string, existingChallengeTitles: string[]) => {
    skipAndReplaceChallenge(challengeId, existingChallengeTitles);
  };

  // Handle skipping a goal and generating a replacement
  const handleSkipGoal = (goalId: string, existingGoalTitles: string[]) => {
    skipAndReplaceGoal(goalId, existingGoalTitles);
  };

  // Handle stopping a topic skip/regeneration (receives ID from the card)
  const handleStopSkipTopic = (topicId: string) => {
    stopTopicSkip(topicId);
  };

  // Handle stopping a challenge skip/regeneration (receives ID from the card)
  const handleStopSkipChallenge = (challengeId: string) => {
    stopChallengeSkip(challengeId);
  };

  // Handle stopping a goal skip/regeneration (receives ID from the card)
  const handleStopSkipGoal = (goalId: string) => {
    stopGoalSkip(goalId);
  };

  const { threads, createThread, sendMessage } = useLearningChat();

  const displayName = getDisplayName(profile);
  const showName = displayName !== 'Developer';

  // getGreeting() reads the visitor's local clock, which only exists in the
  // browser. Computing it during SSR bakes in the server's timezone (UTC in
  // production) and mismatches the client on hydration, so defer it until
  // after mount and show a skeleton in its place for the first paint.
  const hasMounted = useHasMounted();

  /**
   * Handle exploring a learning topic (AC7.1-AC7.4).
   * Creates a new thread pre-seeded with the topic context, sends the seed
   * message, then navigates to the dedicated `/chat` surface where the
   * in-flight stream reattaches via the shared operations manager.
   */
  const handleExploreTopic = async (topic: LearningTopic) => {
    // Create a new thread with the topic as title
    const thread = await createThread(
      {
        title: `Explore: ${topic.title}`,
        context: {
          learningFocus: topic.title,
        },
      },
      true,
    ); // Mark as active

    // Send an initial message to pre-seed the conversation (AC7.2)
    // The learning lens system prompt is applied by the backend (AC7.4)
    // Pass threadId explicitly to avoid race condition with async state update
    const seedMessage = `I'd like to explore "${topic.title}". ${topic.description} This is related to ${topic.relatedTo}. Can you help me understand this better and suggest some practical ways to learn it?`;

    await sendMessage(seedMessage, {
      profile: 'learning',
      capabilities: ['github'],
      threadId: thread.id,
    });

    // Navigate only after the send has registered the stream + operation, so
    // /chat reattaches deterministically (no arbitrary settle delay needed).
    router.push(`/chat?thread=${thread.id}`);
  };

  // Skeleton-aware greeting shown in the page header description. The greeting
  // word waits for mount (client-local time); the name waits for the profile.
  const greeting = (
    <>
      {hasMounted ? getGreeting() : <SkeletonBox height="1em" width="110px" className={styles.skeletonInline} />},{' '}
      {profileLoading || !showName ? (
        <SkeletonBox height="1em" width="80px" className={styles.skeletonInline} />
      ) : (
        displayName
      )}
      ! 👋 Ready to level up your skills? Here&apos;s what&apos;s lined up for you today.
    </>
  );

  return (
    <div className={styles.root}>
      <AppHeader />

      <SplitPageLayout>
        <SplitPageLayout.Content>
          <PageHeader title="Dashboard" description={greeting} />
          <Stack direction="vertical" gap="spacious">
            <ReviewDueWidget />
            <DailyFocusSection
              profile={profile}
              isLoading={profileLoading}
              aiFocus={aiFocus}
              isAIEnabled={isAIEnabled}
              toolsUsed={toolsUsed}
              loadingComponents={loadingComponents}
              onRefresh={handleRefresh}
              onRegenerateChallenge={regenerateChallenge}
              onSkipTopic={handleSkipTopic}
              onStopSkipTopic={handleStopSkipTopic}
              onStopComponent={stopComponent}
              skippingTopicIds={skippingTopicIds}
              onSkipChallenge={handleSkipChallenge}
              onRequestDebugChallenge={requestDebugChallenge}
              onStopSkipChallenge={handleStopSkipChallenge}
              skippingChallengeIds={skippingChallengeIds}
              onSkipGoal={handleSkipGoal}
              onStopSkipGoal={handleStopSkipGoal}
              skippingGoalIds={skippingGoalIds}
              onExploreTopic={handleExploreTopic}
            />
            {/* Compact entry point to the dedicated /chat surface */}
            <ContinueLearningSection threads={threads} />
          </Stack>
        </SplitPageLayout.Content>

        <SplitPageLayout.Pane position={{ regular: 'end', narrow: 'end' }} aria-label="Activity and tips">
          <Stack direction="vertical" gap="spacious">
            <ProfileActivitySection profile={profile} isLoading={profileLoading} onRefresh={refetchProfile} />
            <ProTipSection />
          </Stack>
        </SplitPageLayout.Pane>
      </SplitPageLayout>

      <Footer />
    </div>
  );
}
