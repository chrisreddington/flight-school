'use client';

/**
 * Flight School Dashboard
 * 
 * A polished, GitHub-inspired interface for AI-powered developer learning.
 * Built with Primer React components following modern GitHub design patterns.
 * 
 * Features:
 * - Dynamic user profile from GitHub API
 * - Daily Focus tabs (Challenge, Goal, Learn)
 * - Multi-thread Learning Chat with STREAMING responses
 * - Real-time GitHub activity stats
 */

import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useAIFocus } from '@/hooks/use-ai-focus';
import { useLearningChat } from '@/hooks/use-learning-chat';
import { getDisplayName, useUserProfile } from '@/hooks/use-user-profile';
import type { LearningTopic } from '@/lib/focus/types';
import type { RepoReference } from '@/lib/threads/types';
import { Stack } from '@primer/react';
import { useCallback, useMemo } from 'react';
import { AppHeader } from '../AppHeader';
import { LearningChat } from '../LearningChat';
import { DailyFocusSection } from './daily-focus-section';
import styles from './Dashboard.module.css';
import { Footer } from './footer';
import { ProTipSection } from './pro-tip-section';
import { ProfileActivitySection } from './profile-activity-section';
import { WelcomeSection } from './welcome-section';

// ============================================================================
// Main Component
// ============================================================================

export function Dashboard() {
  // Register homepage in breadcrumb history
  useBreadcrumb('/', 'Dashboard', '/');

  const { data: profile, isLoading: profileLoading, refetch: refetchProfile } = useUserProfile();
  const { data: aiFocus, isAIEnabled, toolsUsed, refetch: refetchFocus, loadingComponents, componentTimestamps, skipAndReplaceTopic, skippingTopicIds, stopComponent, stopTopicSkip } = useAIFocus();
  
  // Adapter for DailyFocusSection which expects string[] format
  const handleRefresh = useCallback((components?: string[]) => {
    const component = components?.[0] as 'challenge' | 'goal' | 'learningTopics' | undefined;
    refetchFocus(component);
  }, [refetchFocus]);

  // Handle skipping a single topic and generating a replacement
  const handleSkipTopic = useCallback((skippedTopic: LearningTopic, existingTopicTitles: string[]) => {
    skipAndReplaceTopic(skippedTopic.id, existingTopicTitles);
  }, [skipAndReplaceTopic]);

  // Handle stopping a topic skip/regeneration - reverts topic state
  const handleStopSkipTopic = useCallback(() => {
    stopTopicSkip();
  }, [stopTopicSkip]);
  
  // Use the new learning chat hook for multi-thread chat
  const {
    threads,
    activeThreadId,
    isStreaming,
    streamingContent,
    streamingThreadIds,
    sendMessage,
    stopStreaming,
    createThread,
    selectThread,
    deleteThread,
    renameThread,
    updateContext,
  } = useLearningChat();

  const displayName = getDisplayName(profile);

  // Memoize available repos to prevent unnecessary re-renders
  const availableRepos = useMemo(() => 
    profile?.repos?.map((repo) => ({
      fullName: repo.fullName,
      owner: repo.owner,
      name: repo.name,
      language: repo.language ?? undefined,
    })) ?? [],
    [profile?.repos]
  );

  // PERF: Consolidate chat handlers to reduce prop drilling and prevent unnecessary re-renders
  const chatHandlers = useMemo(() => ({
    sendMessage: async (message: string, repos?: RepoReference[]) => {
      await sendMessage(message, { useGitHubTools: true, repos });
    },
    createThread,
    selectThread: (threadId: string | null) => {
      if (threadId) selectThread(threadId);
    },
    deleteThread,
    renameThread,
    updateContext,
    stopStreaming,
  }), [sendMessage, createThread, selectThread, deleteThread, renameThread, updateContext, stopStreaming]);

  /**
   * Handle exploring a learning topic (AC7.1-AC7.4).
   * Creates a new thread pre-seeded with the topic context and sends an initial message.
   */
  const handleExploreTopic = useCallback(async (topic: LearningTopic) => {
    // Create a new thread with the topic as title
    const thread = await createThread({
      title: `Explore: ${topic.title}`,
      context: {
        learningFocus: topic.title,
      },
    }, true); // Mark as active

    // Send an initial message to pre-seed the conversation (AC7.2)
    // The learning lens system prompt is applied by the backend (AC7.4)
    // Pass threadId explicitly to avoid race condition with async state update
    const seedMessage = `I'd like to explore "${topic.title}". ${topic.description} This is related to ${topic.relatedTo}. Can you help me understand this better and suggest some practical ways to learn it?`;
    
    await sendMessage(seedMessage, { useGitHubTools: true, threadId: thread.id });
  }, [createThread, sendMessage]);

  return (
    <div className={styles.root}>
      <AppHeader />
      
      <main className={styles.main}>
        <div className={styles.mainContent}>
          <Stack direction="vertical" gap="spacious">
            <WelcomeSection displayName={displayName} isLoading={profileLoading} />
            <DailyFocusSection
              profile={profile} 
              isLoading={profileLoading}
              aiFocus={aiFocus}
              isAIEnabled={isAIEnabled}
              toolsUsed={toolsUsed}
              loadingComponents={loadingComponents}
              componentTimestamps={componentTimestamps}
              onRefresh={handleRefresh}
              onSkipTopic={handleSkipTopic}
              onStopSkipTopic={handleStopSkipTopic}
              onStopComponent={stopComponent}
              skippingTopicIds={skippingTopicIds}
              onExploreTopic={handleExploreTopic}
            />
            {/* Multi-thread Learning Chat Experience */}
            <LearningChat
              threads={threads}
              activeThreadId={activeThreadId}
              handlers={chatHandlers}
              availableRepos={availableRepos}
              isReposLoading={profileLoading}
              isStreaming={isStreaming}
              streamingThreadIds={streamingThreadIds}
              streamingContent={streamingContent}
                userAvatarUrl={profile?.user?.avatarUrl}
            />
          </Stack>
        </div>

        <aside className={styles.sidebar}>
          <Stack direction="vertical" gap="spacious">
            <ProfileActivitySection 
              profile={profile} 
              isLoading={profileLoading} 
              onRefresh={refetchProfile}
            />
            <ProTipSection />
          </Stack>
        </aside>
      </main>

      <Footer />
    </div>
  );
}
