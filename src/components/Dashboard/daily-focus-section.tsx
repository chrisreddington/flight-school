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
    StopIcon,
    ZapIcon,
} from '@primer/octicons-react';
import {
    Button,
    Heading,
    Label,
    Link,
    SkeletonBox,
    Spinner,
    Stack,
    Token,
} from '@primer/react';
import { UnderlinePanels } from '@primer/react/experimental';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useState } from 'react';
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
  /** Callback to skip a single topic and get a replacement */
  onSkipTopic?: (skippedTopic: LearningTopic, existingTopicTitles: string[]) => void;
  /** Callback to stop topic regeneration */
  onStopSkipTopic?: () => void;
  /** Set of topic IDs currently being skipped/regenerated */
  skippingTopicIds?: Set<string>;
  /** Callback to open a learning chat pre-seeded with a topic (AC7.1-AC7.4) */
  onExploreTopic?: (topic: LearningTopic) => void;
  /** Callback to stop a specific component's generation */
  onStopComponent?: (component: 'challenge' | 'goal' | 'learningTopics') => void;
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
  onSkipTopic,
  onStopSkipTopic,
  skippingTopicIds = new Set(),
  onExploreTopic,
  onStopComponent,
}: DailyFocusSectionProps) {
  const { isDebugMode } = useDebugMode();
  const router = useRouter();
  
  // Local state for calibration items - allows persistence on dismiss/confirm
  const [calibrationItems, setCalibrationItems] = useState<CalibrationNeededItem[] | null>(null);
  
  // Use local state if set, otherwise fall back to aiFocus data
  const calibrationNeeded: CalibrationNeededItem[] = calibrationItems ?? aiFocus?.calibrationNeeded ?? [];
  
  // Sync calibration items when aiFocus changes (e.g., on initial load or refresh)
  // Only update if we haven't started managing locally yet
  if (calibrationItems === null && aiFocus?.calibrationNeeded && aiFocus.calibrationNeeded.length > 0) {
    setCalibrationItems(aiFocus.calibrationNeeded);
  }
  
  // Handle calibration item changes (from InlineCalibration)
  const handleCalibrationChange = useCallback((items: CalibrationNeededItem[]) => {
    setCalibrationItems(items);
  }, []);
  
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

  // Handle single topic skip
  const handleSkipTopic = useCallback((skippedTopic: LearningTopic) => {
    if (onSkipTopic) {
      // Pass the titles of remaining non-skipped topics to avoid duplicates
      const existingTitles = learningTopics
        .filter(t => t.id !== skippedTopic.id)
        .map(t => t.title);
      onSkipTopic(skippedTopic, existingTitles);
    }
  }, [learningTopics, onSkipTopic]);

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
                <Stack direction="horizontal" align="center" justify="space-between" style={{ marginBottom: 8 }}>
                  <Stack direction="horizontal" align="center" gap="condensed">
                    <Spinner size="small" />
                    <span className={styles.loadingText}>Generating challenge...</span>
                  </Stack>
                  {/* Only show stop if regenerating (has existing data to fall back to) */}
                  {onStopComponent && aiFocus?.challenge && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => onStopComponent('challenge')}
                      leadingVisual={StopIcon}
                      aria-label="Stop generating challenge"
                    >
                      Stop
                    </Button>
                  )}
                </Stack>
                <SkeletonBox height="20px" width="70%" style={{ marginBottom: 8 }} />
                <SkeletonBox height="40px" width="100%" />
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
                  <InlineCalibration items={calibrationNeeded} onItemsChange={handleCalibrationChange} />
                )}
              </>
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isGoalLoading ? (
              <div className={styles.goalCard}>
                <Stack direction="horizontal" align="center" justify="space-between" style={{ marginBottom: 8 }}>
                  <Stack direction="horizontal" align="center" gap="condensed">
                    <Spinner size="small" />
                    <span className={styles.loadingText}>Generating goal...</span>
                  </Stack>
                  {/* Only show stop if regenerating (has existing data to fall back to) */}
                  {onStopComponent && aiFocus?.goal && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => onStopComponent('goal')}
                      leadingVisual={StopIcon}
                      aria-label="Stop generating goal"
                    >
                      Stop
                    </Button>
                  )}
                </Stack>
                <SkeletonBox height="40px" width="100%" style={{ marginBottom: 16 }} />
                <SkeletonBox height="8px" width="100%" />
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
                <Stack direction="horizontal" align="center" justify="space-between" style={{ marginBottom: 8 }}>
                  <Stack direction="horizontal" align="center" gap="condensed">
                    <Spinner size="small" />
                    <span className={styles.loadingText}>Generating learning topics...</span>
                  </Stack>
                  {/* Only show stop if regenerating (has existing data to fall back to) */}
                  {onStopComponent && aiFocus?.learningTopics?.length && (
                    <Button
                      variant="danger"
                      size="small"
                      onClick={() => onStopComponent('learningTopics')}
                      leadingVisual={StopIcon}
                      aria-label="Stop generating learning topics"
                    >
                      Stop
                    </Button>
                  )}
                </Stack>
                {[1, 2, 3].map((skeletonIndex) => (
                  <div key={`skeleton-topic-${skeletonIndex}`} className={styles.learnCard}>
                    <Stack direction="horizontal" align="start" gap="normal">
                      <SkeletonBox height="44px" width="44px" />
                      <div style={{ flex: 1 }}>
                        <SkeletonBox height="16px" width="50%" style={{ marginBottom: 4 }} />
                        <SkeletonBox height="16px" width="80%" />
                      </div>
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
                    onSkip={handleSkipTopic}
                    onStopSkip={onStopSkipTopic}
                    isSkipping={skippingTopicIds.has(topic.id)}
                  />
                ))}
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
