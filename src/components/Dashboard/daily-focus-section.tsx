'use client';

import type { ProfileResponse } from '@/app/api/profile/route';
import { ChallengeCard, GoalCard, TopicCard } from '@/components/FocusItem';
import { HabitsSection } from './habits-section';
import { useDebugMode } from '@/contexts/debug-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import type { CalibrationNeededItem, DailyChallenge, FocusResponse, LearningTopic } from '@/lib/focus/types';
import {
    BookIcon,
    CheckCircleIcon,
    CopilotIcon,
    FlameIcon,
    RocketIcon,
    SkipIcon,
    ZapIcon,
} from '@primer/octicons-react';
import {
    Button,
    Heading,
    Label,
    Link,
    SkeletonBox,
    Stack,
    Token,
} from '@primer/react';
import { UnderlinePanels } from '@primer/react/experimental';
import { useRouter } from 'next/navigation';
import { memo, useCallback } from 'react';
import {
    getDynamicChallenge,
    getDynamicGoal,
    getDynamicLearningTopics,
} from './dashboard-helpers';
import styles from './Dashboard.module.css';
import { InlineCalibration } from './inline-calibration';

interface DailyFocusSectionProps {
  profile: ProfileResponse | null;
  isLoading: boolean;
  aiFocus: FocusResponse | null;
  isAIEnabled: boolean;
  toolsUsed: string[];
  loadingComponents: string[];
  componentTimestamps: {
    challenge: string | null;
    goal: string | null;
    learningTopics: string | null;
  };
  onRefresh: (components?: string[]) => void;
  /** Callback to open a learning chat pre-seeded with a topic (AC7.1-AC7.4) */
  onExploreTopic?: (topic: LearningTopic) => void;
}

export const DailyFocusSection = memo(function DailyFocusSection({
  profile,
  isLoading,
  aiFocus,
  isAIEnabled,
  toolsUsed,
  loadingComponents,
  componentTimestamps,
  onRefresh,
  onExploreTopic,
}: DailyFocusSectionProps) {
  const { isDebugMode } = useDebugMode();
  const router = useRouter();
  
  // Get the daily challenge from AI focus or fallback
  const dailyChallenge: DailyChallenge | null = aiFocus?.challenge || getDynamicChallenge(profile);
  
  // Use custom challenge queue for priority handling (S3)
  const {
    activeChallenge,
    activeSource,
    queueRemaining,
  } = useCustomChallengeQueue(dailyChallenge);
  
  // Use active challenge (custom takes priority over daily)
  const challenge = activeChallenge || dailyChallenge || getDynamicChallenge(profile);
  const isCustomChallenge = challenge?.isCustom || activeSource === 'custom-queue';
  
  const goal = aiFocus?.goal || getDynamicGoal(profile);
  const learningTopics = aiFocus?.learningTopics?.length ? aiFocus.learningTopics : getDynamicLearningTopics(profile);
  const calibrationNeeded: CalibrationNeededItem[] = aiFocus?.calibrationNeeded || [];

  // Navigate to create challenge page
  const handleCreateChallenge = useCallback(() => {
    router.push('/challenge/create');
  }, [router]);

  // Profile loading blocks all tabs (no data available yet)
  // But once profile is loaded, each tab renders independently based on its own loading state
  const isProfileLoading = isLoading;
  
  // Per-component loading states for progressive rendering
  const isChallengeLoading = isProfileLoading || loadingComponents.includes('challenge');
  const isGoalLoading = isProfileLoading || loadingComponents.includes('goal');
  const isTopicsLoading = isProfileLoading || loadingComponents.includes('learningTopics');

  return (
    <section className={styles.card}>
      <Stack direction="horizontal" align="center" justify="space-between" className={styles.sectionHeader}>
        <Stack direction="horizontal" align="center" gap="condensed">
          <span className={styles.iconAttention}>
            <ZapIcon size={20} />
          </span>
          <Heading as="h3" className={styles.sectionTitle}>
            Daily Focus
          </Heading>
          {isAIEnabled && (
            <Label variant="success" size="small">
              <span style={{ marginRight: '4px', display: 'inline-flex' }}><CopilotIcon size={12} /></span>
              AI-Powered
            </Label>
          )}
          {toolsUsed.length > 0 && (
            <Token text={isDebugMode ? toolsUsed.join(', ') : `Used ${toolsUsed.length} tools`} />
          )}
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed">
          <Link href="/focus-history" className={styles.historyLink}>
            View History
          </Link>
        </Stack>
      </Stack>

      <UnderlinePanels aria-label="Daily focus tabs" className={styles.focusTabs}>
        <UnderlinePanels.Tab aria-selected>
          <FlameIcon size={16} /> Challenge
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <CheckCircleIcon size={16} /> Goal
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <BookIcon size={16} /> Learn
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <RocketIcon size={16} /> Habits
        </UnderlinePanels.Tab>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isChallengeLoading ? (
              <div className={styles.challengeCard}>
                <Stack direction="horizontal" align="center" gap="condensed" style={{ marginBottom: 8 }}>
                  <SkeletonBox height="20px" width="80px" />
                  <SkeletonBox height="20px" width="100px" />
                  <SkeletonBox height="16px" width="60px" />
                </Stack>
                <SkeletonBox height="20px" width="70%" style={{ marginBottom: 8 }} />
                <SkeletonBox height="40px" width="100%" />
                <Stack direction="horizontal" gap="condensed" style={{ marginTop: 16 }}>
                  <SkeletonBox height="32px" width="120px" />
                  <SkeletonBox height="32px" width="32px" />
                </Stack>
              </div>
            ) : (
              <>
                <ChallengeCard
                  challenge={challenge}
                  isCustom={isCustomChallenge}
                  onRefresh={!isCustomChallenge ? () => onRefresh(['challenge']) : undefined}
                  onEdit={isCustomChallenge ? () => router.push(`/challenge/edit/${challenge.id}`) : undefined}
                  onCreate={handleCreateChallenge}
                  refreshDisabled={isChallengeLoading}
                  timestamp={componentTimestamps.challenge}
                  queueCount={queueRemaining}
                />
                {calibrationNeeded.length > 0 && (
                  <InlineCalibration items={calibrationNeeded} />
                )}
              </>
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isGoalLoading ? (
              <div className={styles.goalCard}>
                <SkeletonBox height="20px" width="60%" style={{ marginBottom: 8 }} />
                <SkeletonBox height="40px" width="100%" style={{ marginBottom: 16 }} />
                <SkeletonBox height="8px" width="100%" style={{ marginBottom: 16 }} />
                <Stack direction="horizontal" gap="condensed">
                  <SkeletonBox height="32px" width="160px" />
                  <SkeletonBox height="32px" width="100px" />
                </Stack>
              </div>
            ) : (
              <GoalCard
                goal={goal}
                onRefresh={() => onRefresh(['goal'])}
                refreshDisabled={isGoalLoading}
              />
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isTopicsLoading ? (
              <Stack direction="vertical" gap="normal">
                {[1, 2].map((skeletonIndex) => (
                  <div key={`skeleton-topic-${skeletonIndex}`} className={styles.learnCard}>
                    <Stack direction="horizontal" align="start" gap="normal">
                      <SkeletonBox height="44px" width="44px" />
                      <div style={{ flex: 1 }}>
                        <SkeletonBox height="16px" width="50%" style={{ marginBottom: 4 }} />
                        <SkeletonBox height="16px" width="80%" />
                      </div>
                      <SkeletonBox height="28px" width="70px" />
                    </Stack>
                  </div>
                ))}
              </Stack>
            ) : (
              <Stack direction="vertical" gap="normal">
                {learningTopics.map((topic) => (
                  <TopicCard
                    key={topic.id}
                    topic={topic}
                    onExplore={onExploreTopic}
                  />
                ))}
                <Stack direction="horizontal" justify="start">
                  <Button
                    variant="invisible"
                    leadingVisual={SkipIcon}
                    onClick={() => onRefresh(['learningTopics'])}
                    disabled={isTopicsLoading}
                  >
                    Skip Topics
                  </Button>
                </Stack>
              </Stack>
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            <HabitsSection />
          </div>
        </UnderlinePanels.Panel>
      </UnderlinePanels>
    </section>
  );
});
