'use client';

import type { ProfileResponse } from '@/app/api/profile/route';
import { ChallengeCard, GoalCard, TopicCard } from '@/components/FocusItem';
import { SkippingCard } from '@/components/FocusItem/SkippingCard';
import { HabitsSection } from './habits-section';
import { useDebugMode } from '@/contexts/debug-context';
import { useCustomChallengeQueue } from '@/hooks/use-custom-challenge-queue';
import type { RegenerateChallengeResult } from '@/app/challenge/actions';
import { focusStore } from '@/lib/focus';
import type { CalibrationNeededItem, DailyChallenge, FocusResponse, LearningTopic } from '@/lib/focus/types';
import { getDateKey } from '@/lib/utils/date-utils';
import {
  BookIcon,
  CheckIcon,
  CodeIcon,
  CopilotIcon,
  FlameIcon,
  HistoryIcon,
  StopIcon,
  ZapIcon,
} from '@primer/octicons-react';
import { Button, Heading, Label, Link, SkeletonBox, Spinner, Stack, Token } from '@primer/react';
import { UnderlinePanels } from '@primer/react/experimental';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useEffect, useState } from 'react';
import { useRateLimitCountdown } from '@/hooks/use-rate-limit-countdown';
import { getDynamicChallenge, getDynamicGoal, getDynamicLearningTopics } from './dashboard-helpers';
import styles from './Dashboard.module.css';
import { InlineCalibration } from './inline-calibration';

interface DailyFocusSectionProps {
  profile: ProfileResponse | null;
  isLoading: boolean;
  aiFocus: FocusResponse | null;
  isAIEnabled: boolean;
  toolsUsed: string[];
  loadingComponents: string[];
  onRefresh: (components?: string[]) => void;
  onRegenerateChallenge?: (currentChallengeId?: string) => Promise<RegenerateChallengeResult>;
  /** Callback to skip a single topic and get a replacement */
  onSkipTopic?: (skippedTopic: LearningTopic, existingTopicTitles: string[]) => void;
  /** Callback to stop topic regeneration (receives topic ID) */
  onStopSkipTopic?: (topicId: string) => void;
  /** Set of topic IDs currently being skipped/regenerated */
  skippingTopicIds?: Set<string>;
  /** Callback to skip a challenge and get a replacement */
  onSkipChallenge?: (challengeId: string, existingChallengeTitles: string[]) => void;
  /** Callback to request a debug challenge */
  onRequestDebugChallenge?: () => void;
  /** Callback to stop challenge regeneration (receives challenge ID) */
  onStopSkipChallenge?: (challengeId: string) => void;
  /** Set of challenge IDs currently being skipped/regenerated */
  skippingChallengeIds?: Set<string>;
  /** Callback to skip a goal and get a replacement */
  onSkipGoal?: (goalId: string, existingGoalTitles: string[]) => void;
  /** Callback to stop goal regeneration (receives goal ID) */
  onStopSkipGoal?: (goalId: string) => void;
  /** Set of goal IDs currently being skipped/regenerated */
  skippingGoalIds?: Set<string>;
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
  onRefresh,
  onRegenerateChallenge,
  onSkipTopic,
  onStopSkipTopic,
  skippingTopicIds = new Set(),
  onSkipChallenge,
  onRequestDebugChallenge,
  onStopSkipChallenge,
  skippingChallengeIds = new Set(),
  onSkipGoal,
  onStopSkipGoal,
  skippingGoalIds = new Set(),
  onExploreTopic,
  onStopComponent,
}: DailyFocusSectionProps) {
  const { isDebugMode } = useDebugMode();
  const router = useRouter();

  // Local state for calibration items - allows persistence on dismiss/confirm
  const [calibrationItems, setCalibrationItems] = useState<CalibrationNeededItem[] | null>(null);
  const [isChallengeRefreshSuggested, setIsChallengeRefreshSuggested] = useState(false);
  // The "New challenge" / "Refresh suggestion" actions call an awaited server
  // action that swaps the card in place. Without this flag the old card would
  // sit unchanged until the swap, giving no sign the request was accepted.
  const [isRegeneratingChallenge, setIsRegeneratingChallenge] = useState(false);

  // Use local state if set, otherwise fall back to aiFocus data
  const calibrationNeeded: CalibrationNeededItem[] = calibrationItems ?? aiFocus?.calibrationNeeded ?? [];

  // Seed local calibration state from the fresh aiFocus payload once
  // (subsequent edits stay client-side until the next focus refresh).
  // Doing this in useEffect rather than during render avoids the Strict
  // Mode warning about setState-in-render.
  useEffect(() => {
    if (calibrationItems !== null) return;
    const incoming = aiFocus?.calibrationNeeded;
    if (incoming && incoming.length > 0) {
      setCalibrationItems(incoming);
    }
  }, [aiFocus?.calibrationNeeded, calibrationItems]);

  // Handle calibration item changes (from InlineCalibration)
  const handleCalibrationChange = useCallback((items: CalibrationNeededItem[]) => {
    setCalibrationItems(items);
    setIsChallengeRefreshSuggested(true);
  }, []);

  // Get the daily challenge from AI focus or fallback
  const dailyChallenge: DailyChallenge | null =
    (aiFocus?.challenge?.title ? aiFocus.challenge : null) || getDynamicChallenge(profile);

  // Use custom challenge queue for priority handling (S3)
  const { activeChallenge, activeSource, queueRemaining, advanceQueue } = useCustomChallengeQueue(dailyChallenge);

  // Use active challenge (custom takes priority over daily)
  const challenge = activeChallenge || dailyChallenge || getDynamicChallenge(profile);
  const isCustomChallenge = challenge?.isCustom || activeSource === 'custom-queue';

  useEffect(() => {
    setIsChallengeRefreshSuggested(false);
  }, [challenge.id]);

  const handleAdvanceQueue = useCallback(async () => {
    const dateKey = getDateKey();
    await focusStore.addChallenge(dateKey, challenge);
    await focusStore.transitionChallenge(dateKey, challenge.id, 'completed', 'advance-queue');
    await advanceQueue();
  }, [challenge, advanceQueue]);

  const handleSkipCustomChallenge = useCallback(
    async (challengeId: string) => {
      if (challenge.id !== challengeId) return;

      const dateKey = getDateKey();
      await focusStore.addChallenge(dateKey, challenge);
      await focusStore.transitionChallenge(dateKey, challenge.id, 'skipped', 'skip-queue');
      await advanceQueue();
    },
    [challenge, advanceQueue],
  );

  const goal = aiFocus?.goal || getDynamicGoal(profile);
  const learningTopics = aiFocus?.learningTopics?.length ? aiFocus.learningTopics : getDynamicLearningTopics(profile);

  // Handle single topic skip
  const handleSkipTopic = useCallback(
    (skippedTopic: LearningTopic) => {
      if (onSkipTopic) {
        // Pass the titles of remaining non-skipped topics to avoid duplicates
        const existingTitles = learningTopics.filter((t) => t.id !== skippedTopic.id).map((t) => t.title);
        onSkipTopic(skippedTopic, existingTitles);
      }
    },
    [learningTopics, onSkipTopic],
  );

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
  const { disabled: isRateLimited } = useRateLimitCountdown();
  const isChallengeRefreshDisabled = isChallengeLoading || isRateLimited;
  const isGoalRefreshDisabled = isGoalLoading || isRateLimited;
  const isTopicsLoading = isProfileLoading || loadingComponents.includes('learningTopics');

  // Regenerate today's challenge, showing an in-progress skeleton for the
  // duration of the awaited server action. Falls back to the streaming refresh
  // (which sets its own loading state) when no regenerate handler is wired.
  const handleRegenerateChallenge = useCallback(async () => {
    if (!onRegenerateChallenge) {
      onRefresh(['challenge']);
      return;
    }
    setIsRegeneratingChallenge(true);
    try {
      await onRegenerateChallenge(challenge.id);
    } finally {
      setIsRegeneratingChallenge(false);
    }
  }, [onRegenerateChallenge, onRefresh, challenge.id]);

  function handleRefreshSuggestionClick(): void {
    void handleRegenerateChallenge();
    setIsChallengeRefreshSuggested(false);
  }

  return (
    <section className={styles.card}>
      <Stack direction="horizontal" align="center" justify="space-between" className={styles.sectionHeader}>
        <Stack direction="horizontal" align="center" gap="condensed">
          <span className={styles.iconAttention}>
            <ZapIcon size={20} />
          </span>
          <Heading as="h2" className={styles.sectionTitle}>
            Daily Focus
          </Heading>
          {isAIEnabled && (
            <Label variant="success" size="small">
              <span className={styles.iconInline}>
                <CopilotIcon size={12} />
              </span>
              AI-Powered
            </Label>
          )}
          {toolsUsed.length > 0 && (
            <Token text={isDebugMode ? toolsUsed.join(', ') : `Used ${toolsUsed.length} tools`} />
          )}
        </Stack>
        <Stack direction="horizontal" align="center" gap="condensed">
          <Link href="/history" className={styles.historyLink}>
            <HistoryIcon size={16} /> History
          </Link>
        </Stack>
      </Stack>

      <UnderlinePanels aria-label="Daily focus tabs" className={styles.focusTabs}>
        <UnderlinePanels.Tab aria-selected>
          <CodeIcon size={16} /> Challenge
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <CheckIcon size={16} /> Goal
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <BookIcon size={16} /> Learn
        </UnderlinePanels.Tab>
        <UnderlinePanels.Tab>
          <FlameIcon size={16} /> Habits
        </UnderlinePanels.Tab>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isChallengeLoading ? (
              <div className={styles.challengeCard}>
                <Stack
                  direction="horizontal"
                  align="center"
                  justify="space-between"
                  className={styles.skeletonLoadingRow}
                >
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
                <SkeletonBox height="20px" width="70%" className={styles.skeletonMbSm} />
                <SkeletonBox height="40px" width="100%" />
              </div>
            ) : isRegeneratingChallenge ? (
              <SkippingCard id={challenge.id} itemType="challenge" skeletonLines={3} />
            ) : (
              <>
                <ChallengeCard
                  challenge={challenge}
                  isCustom={isCustomChallenge}
                  onRefresh={!isCustomChallenge ? handleRegenerateChallenge : undefined}
                  onEdit={isCustomChallenge ? () => router.push(`/challenge/edit/${challenge.id}`) : undefined}
                  onCreate={handleCreateChallenge}
                  onSkipAndReplace={isCustomChallenge ? handleSkipCustomChallenge : onSkipChallenge}
                  onRequestDebugChallenge={!isCustomChallenge ? onRequestDebugChallenge : undefined}
                  onStopSkip={onStopSkipChallenge}
                  isSkipping={skippingChallengeIds.has(challenge.id)}
                  refreshDisabled={isChallengeRefreshDisabled}
                  queueCount={queueRemaining}
                  showIssueContextBadge={challenge.contextSource === 'issue'}
                  onAdvanceQueue={isCustomChallenge ? handleAdvanceQueue : undefined}
                />
                {calibrationNeeded.length > 0 && (
                  <InlineCalibration items={calibrationNeeded} onItemsChange={handleCalibrationChange} />
                )}
                {isChallengeRefreshSuggested && (
                  <Button size="small" variant="default" onClick={handleRefreshSuggestionClick}>
                    Refresh suggestion
                  </Button>
                )}
              </>
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isGoalLoading ? (
              <div className={styles.goalCard}>
                <Stack
                  direction="horizontal"
                  align="center"
                  justify="space-between"
                  className={styles.skeletonLoadingRow}
                >
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
                <SkeletonBox height="40px" width="100%" className={styles.skeletonMbMd} />
                <SkeletonBox height="8px" width="100%" />
              </div>
            ) : (
              <GoalCard
                goal={goal}
                onRefresh={() => onRefresh(['goal'])}
                onSkipAndReplace={onSkipGoal}
                onStopSkip={onStopSkipGoal}
                isSkipping={skippingGoalIds.has(goal.id)}
                refreshDisabled={isGoalRefreshDisabled}
              />
            )}
          </div>
        </UnderlinePanels.Panel>

        <UnderlinePanels.Panel>
          <div className={styles.focusContent}>
            {isTopicsLoading ? (
              <Stack direction="vertical" gap="normal">
                <Stack
                  direction="horizontal"
                  align="center"
                  justify="space-between"
                  className={styles.skeletonLoadingRow}
                >
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
                      <div className={styles.skeletonFlex}>
                        <SkeletonBox height="16px" width="50%" className={styles.skeletonMbXs} />
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
