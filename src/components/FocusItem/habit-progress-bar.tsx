/**
 * Habit Progress Bar Component
 * 
 * Displays progress tracking for time and count-based habits.
 * Shows current progress against target with visual progress bar.
 */

import type { HabitWithHistory } from '@/lib/habits/types';
import { ProgressBar, Stack } from '@primer/react';
import styles from './FocusItem.module.css';

interface HabitProgressBarProps {
  habit: HabitWithHistory;
  currentValue: number;
  elapsedTime: number;
  isPaused: boolean;
}

export function HabitProgressBar({ habit, currentValue, elapsedTime, isPaused }: HabitProgressBarProps) {
  // Format time for display
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    
    if (minutes === 0) {
      return `${seconds}s`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  if (habit.tracking.mode === 'time') {
    const config = habit.tracking;
    const elapsedMinutes = elapsedTime / (60 * 1000);
    const timeProgress = Math.min((elapsedMinutes / config.minMinutes) * 100, 100);
    const isGoalReached = elapsedMinutes >= config.minMinutes;

    return (
      <Stack direction="vertical" gap="condensed">
        <Stack direction="horizontal" justify="space-between">
          <span className={styles.progressLabel}>
            {isGoalReached ? 'Goal Reached!' : 'Session:'}
          </span>
          <span className={styles.progressValue}>
            {isGoalReached ? (
              <span className={styles.textSuccess}>
                {formatTime(elapsedTime)} / {config.minMinutes} min ✓
              </span>
            ) : (
              <>
                {formatTime(elapsedTime)} / {config.minMinutes} min
              </>
            )}
            {isPaused && <span className="fgColor-muted"> (Paused)</span>}
          </span>
        </Stack>
        <ProgressBar
          progress={timeProgress}
          bg={isGoalReached ? 'var(--bgColor-success-muted)' : 'var(--bgColor-accent-muted)'}
        />
      </Stack>
    );
  } else if (habit.tracking.mode === 'count') {
    const config = habit.tracking;
    const countProgress = Math.min((currentValue / config.target) * 100, 100);

    return (
      <Stack direction="vertical" gap="condensed">
        <Stack direction="horizontal" justify="space-between">
          <span className={styles.progressLabel}>Progress:</span>
          <span className={styles.progressValue}>
            {currentValue}/{config.target} {config.unit}
          </span>
        </Stack>
        <ProgressBar
          progress={countProgress}
          bg={currentValue >= config.target ? 'var(--bgColor-success-muted)' : 'var(--bgColor-accent-muted)'}
        />
      </Stack>
    );
  }

  return null;
}
