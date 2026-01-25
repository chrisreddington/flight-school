/**
 * Shared Goal Card Component
 * 
 * Displays a goal with consistent styling and actions across Dashboard and History.
 * Automatically detects state from storage.
 */

import { focusStore } from '@/lib/focus';
import type { GoalState } from '@/lib/focus/state-machine';
import type { DailyGoal } from '@/lib/focus/types';
import { getDateKey, isTodayDateKey } from '@/lib/utils/date-utils';
import { CheckIcon, SkipIcon, StopIcon, ZapIcon } from '@primer/octicons-react';
import { Button, Heading, Label, SkeletonBox, Spinner, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import styles from './FocusItem.module.css';

interface GoalCardProps {
  goal: DailyGoal;
  /** Optional date key for history items (defaults to today) */
  dateKey?: string;
  /** Show history-specific actions (Mark Complete, Skip) */
  showHistoryActions?: boolean;
  /** Callback when goal is refreshed/skipped */
  onRefresh?: () => void;
  /** Callback after state transition */
  onStateChange?: () => void;
  /** Callback to skip this goal and regenerate a new one (with existing titles to avoid) */
  onSkipAndReplace?: (goalId: string, existingGoalTitles: string[]) => void;
  /** Callback to stop the skip/regeneration in progress (receives the goal ID) */
  onStopSkip?: (goalId: string) => void;
  /** Whether skip/regeneration is in progress */
  isSkipping?: boolean;
  /** Whether refresh is disabled */
  refreshDisabled?: boolean;
}

export function GoalCard({
  goal,
  dateKey = getDateKey(),
  showHistoryActions = false,
  onRefresh,
  onStateChange,
  onSkipAndReplace,
  onStopSkip,
  isSkipping = false,
  refreshDisabled = false,
}: GoalCardProps) {
  const [currentState, setCurrentState] = useState<GoalState>('not-started');

  // Load current state from storage
  useEffect(() => {
    (async () => {
      const history = await focusStore.getHistory();
      const record = history[dateKey];
      if (record?.goals) {
        const item = record.goals.find(g => g.data.id === goal.id);
        if (item && item.stateHistory.length > 0) {
          setCurrentState(item.stateHistory[item.stateHistory.length - 1].state);
        }
      }
    })();
  }, [dateKey, goal.id]);

  const handleMarkComplete = useCallback(async () => {
    await focusStore.transitionGoal(dateKey, goal.id, 'completed', 'dashboard');
    setCurrentState('completed');
    if (onStateChange) onStateChange();
  }, [dateKey, goal.id, onStateChange]);

  const handleSkip = useCallback(async () => {
    // If we have skip-and-replace handler, use it for background regeneration
    // Don't mark as skipped yet - that happens after replacement succeeds
    if (onSkipAndReplace) {
      onSkipAndReplace(goal.id, [goal.title]);
      return;
    }
    
    // Fallback: just mark as skipped and refresh
    await focusStore.transitionGoal(dateKey, goal.id, 'skipped', 'dashboard');
    setCurrentState('skipped');
    if (onStateChange) onStateChange();
    if (onRefresh) onRefresh();
  }, [dateKey, goal.id, goal.title, onStateChange, onRefresh, onSkipAndReplace]);

  const isCompleted = currentState === 'completed';
  const isSkipped = currentState === 'skipped';
  const isToday = isTodayDateKey(dateKey);

  // Show loading state while regenerating (with stop button on dashboard)
  if (isSkipping) {
    return (
      <div className={styles.card}>
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" align="center" justify="space-between">
            <Stack direction="horizontal" align="center" gap="condensed">
              <Spinner size="small" />
              <span className={styles.loadingText}>Generating new goal...</span>
            </Stack>
            {onStopSkip && (
              <Button
                variant="danger"
                size="small"
                onClick={() => onStopSkip(goal.id)}
                leadingVisual={StopIcon}
                aria-label="Stop generating goal"
              >
                Stop
              </Button>
            )}
          </Stack>
          <SkeletonBox height="24px" width="70%" />
          <SkeletonBox height="16px" width="100%" />
        </Stack>
      </div>
    );
  }

  // Don't render skipped goals on dashboard (they've been replaced)
  if (isSkipped && !showHistoryActions) {
    return null;
  }

  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Label size="small" variant="accent">
            <span style={{ marginRight: '4px', display: 'inline-flex' }}><ZapIcon size={12} /></span>
            Goal
          </Label>
          {(isCompleted || isSkipped) && showHistoryActions && (
            <Label variant={isCompleted ? 'success' : 'secondary'}>
              {isCompleted ? 'Completed' : 'Skipped'}
            </Label>
          )}
        </Stack>

        <Heading as="h3">{goal.title}</Heading>
        <p className={styles.description}>{goal.description}</p>

        {goal.reasoning && (
          <p className={styles.reasoning}>
            <strong>Why:</strong> {goal.reasoning}
          </p>
        )}

        <Stack direction="horizontal" gap="condensed">
          {showHistoryActions ? (
            <>
              <Button
                variant="primary"
                leadingVisual={CheckIcon}
                onClick={handleMarkComplete}
                disabled={isCompleted || isSkipped}
              >
                Mark Complete
              </Button>
              {/* Only show Skip button on today's items */}
              {isToday && (
                <Button
                  variant="invisible"
                  leadingVisual={SkipIcon}
                  onClick={handleSkip}
                  disabled={isCompleted || isSkipped || refreshDisabled}
                >
                  Skip Goal
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="primary"
                leadingVisual={CheckIcon}
                onClick={handleMarkComplete}
                disabled={isCompleted || isSkipped}
              >
                Complete
              </Button>
              {/* Only show Skip button on today's items */}
              {isToday && (
                <Button
                  variant="invisible"
                  leadingVisual={SkipIcon}
                  onClick={handleSkip}
                  disabled={isCompleted || isSkipped || refreshDisabled}
                >
                  Skip Goal
                </Button>
              )}
            </>
          )}
        </Stack>
      </Stack>
    </div>
  );
}
