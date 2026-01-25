/**
 * Shared Challenge Card Component
 * 
 * Displays a challenge with consistent styling and actions across Dashboard and History.
 * Automatically detects state (in-progress vs not-started) from storage.
 */

import { ChallengeActionMenu } from '@/components/ChallengeActionMenu';
import { DifficultyBadge } from '@/components/DifficultyBadge';
import { MarkdownContent } from '@/components/MarkdownContent';
import { focusStore } from '@/lib/focus';
import type { ChallengeState } from '@/lib/focus/state-machine';
import type { DailyChallenge } from '@/lib/focus/types';
import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import { ClockIcon } from '@primer/octicons-react';
import { Button, Heading, Label, SkeletonBox, Spinner, Stack } from '@primer/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import styles from './FocusItem.module.css';

interface ChallengeCardProps {
  challenge: DailyChallenge;
  /** Optional date key for history items (defaults to today) */
  dateKey?: string;
  /** Show history-specific actions (Mark Complete, Skip) */
  showHistoryActions?: boolean;
  /** Whether this is a custom challenge */
  isCustom?: boolean;
  /** Callback when challenge is refreshed/skipped */
  onRefresh?: () => void;
  /** Callback when custom challenge is edited */
  onEdit?: () => void;
  /** Callback when "Create" is clicked */
  onCreate?: () => void;
  /** Callback after state transition */
  onStateChange?: () => void;
  /** Callback to skip this challenge and regenerate a new one (with existing titles to avoid) */
  onSkipAndReplace?: (challengeId: string, existingChallengeTitles: string[]) => void;
  /** Whether skip/regeneration is in progress */
  isSkipping?: boolean;
  /** Whether refresh is disabled */
  refreshDisabled?: boolean;
  /** Optional timestamp for last update */
  timestamp?: string | null;
  /** Queue count indicator */
  queueCount?: number;
}

export function ChallengeCard({
  challenge,
  dateKey = getDateKey(),
  showHistoryActions = false,
  isCustom = false,
  onRefresh,
  onEdit,
  onCreate,
  onStateChange,
  onSkipAndReplace,
  isSkipping = false,
  refreshDisabled = false,
  timestamp,
  queueCount,
}: ChallengeCardProps) {
  const router = useRouter();
  const [currentState, setCurrentState] = useState<ChallengeState>('not-started');

  // Load current state from storage
  useEffect(() => {
    (async () => {
      const history = await focusStore.getHistory();
      const record = history[dateKey];
      if (record?.challenges) {
        const item = record.challenges.find(c => c.data.id === challenge.id);
        if (item && item.stateHistory.length > 0) {
          setCurrentState(item.stateHistory[item.stateHistory.length - 1].state);
        }
      }
    })();
  }, [dateKey, challenge.id]);

  const handleStartChallenge = useCallback(() => {
    if (currentState === 'not-started') {
      // Transition to in-progress when starting
      (async () => {
        await focusStore.transitionChallenge(dateKey, challenge.id, 'in-progress', 'dashboard');
        setCurrentState('in-progress');
        if (onStateChange) onStateChange();
      })();
    }
    // Navigate to sandbox with full challenge details
    const params = new URLSearchParams({
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      language: challenge.language,
      difficulty: challenge.difficulty,
    });
    router.push(`/challenge?${params.toString()}`);
  }, [router, challenge, currentState, dateKey, onStateChange]);

  const handleMarkComplete = useCallback(async () => {
    await focusStore.transitionChallenge(dateKey, challenge.id, 'completed', 'history');
    setCurrentState('completed');
    if (onStateChange) onStateChange();
  }, [dateKey, challenge.id, onStateChange]);

  const handleSkip = useCallback(async () => {
    // If we have skip-and-replace handler, use it for background regeneration
    // Don't mark as skipped yet - that happens after replacement succeeds
    if (onSkipAndReplace) {
      onSkipAndReplace(challenge.id, [challenge.title]);
      return;
    }
    
    // Fallback: just mark as skipped and refresh
    await focusStore.transitionChallenge(dateKey, challenge.id, 'skipped', 'history');
    setCurrentState('skipped');
    if (onStateChange) onStateChange();
    if (onRefresh) onRefresh();
  }, [dateKey, challenge.id, challenge.title, onStateChange, onRefresh, onSkipAndReplace]);

  const isCompleted = currentState === 'completed';
  const isSkipped = currentState === 'skipped';
  const isInProgress = currentState === 'in-progress';
  const isToday = isTodayDateKey(dateKey);

  // Show loading state while regenerating
  if (isSkipping) {
    return (
      <div className={styles.card}>
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" align="center" gap="condensed">
            <Spinner size="small" />
            <span className={styles.loadingText}>Generating new challenge...</span>
          </Stack>
          <SkeletonBox height="24px" width="70%" />
          <SkeletonBox height="16px" width="100%" />
          <SkeletonBox height="16px" width="90%" />
        </Stack>
      </div>
    );
  }

  // Don't render skipped challenges on dashboard (they've been replaced)
  if (isSkipped && !showHistoryActions) {
    return null;
  }

  return (
    <div className={styles.card}>
      {timestamp && !isCustom && (
        <span className={styles.timestamp}>
          <ClockIcon size={12} /> Updated {timestamp}
        </span>
      )}
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Stack direction="horizontal" gap="condensed" align="center">
            {isCustom && (
              <Label size="small" variant="accent">
                Custom
              </Label>
            )}
            <DifficultyBadge difficulty={challenge.difficulty} showIcon />
            <Label size="small">{challenge.language}</Label>
            {challenge.estimatedTime && (
              <Label size="small" variant="secondary">
                <span style={{ marginRight: 4, display: 'inline-flex' }}><ClockIcon size={12} /></span>
                {challenge.estimatedTime}
              </Label>
            )}
            {queueCount !== undefined && queueCount > 1 && (
              <Label size="small" variant="secondary">
                +{queueCount - 1} more in queue
              </Label>
            )}
          </Stack>
          {/* Only show action menu on today's items */}
          {isToday && (
            <ChallengeActionMenu
              challenge={challenge}
              isCustom={isCustom}
              onEdit={isCustom ? onEdit : undefined}
              onSkip={isCustom ? handleSkip : undefined}
              onRefresh={!isCustom ? onRefresh : undefined}
              onCreate={onCreate}
              onMarkComplete={showHistoryActions ? handleMarkComplete : undefined}
              showHistoryActions={showHistoryActions}
              refreshDisabled={refreshDisabled}
            />
          )}
        </Stack>

        <Heading as="h3">{challenge.title}</Heading>
        <div className={styles.description}>
          <MarkdownContent content={challenge.description} />
        </div>

        {challenge.whyThisChallenge && challenge.whyThisChallenge.length > 0 && (
          <div className={styles.reasoning}>
            <strong>Why this challenge:</strong>
            <ul>
              {challenge.whyThisChallenge.map((reason, idx) => (
                <li key={idx}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        <Stack direction="horizontal" gap="condensed">
          <Button
            variant="primary"
            onClick={handleStartChallenge}
            disabled={isCompleted || isSkipped}
          >
            {isInProgress ? 'Continue Challenge' : 'Start Challenge'}
          </Button>
          {(isCompleted || isSkipped) && (
            <Label variant={isCompleted ? 'success' : 'secondary'}>
              {isCompleted ? '✓ Completed' : '⏭ Skipped'}
            </Label>
          )}
        </Stack>
      </Stack>
    </div>
  );
}
