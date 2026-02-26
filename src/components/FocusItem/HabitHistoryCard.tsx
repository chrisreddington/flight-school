/**
 * Habit History Card
 * 
 * Shows a single day's check-in status for a habit.
 * - Past days: Read-only historical view with status
 * - Today: Full interactive experience with tracking UI and actions
 */

import { habitStore } from '@/lib/habits';
import { checkInHabit, isPendingToday, getRemainingSkips, skipHabitDay, undoCheckIn } from '@/lib/habits/state-machine';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import { CheckIcon, SkipIcon, FlameIcon, PlayIcon, PauseIcon, LinkExternalIcon } from '@primer/octicons-react';
import { Button, Label, Link, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import { HabitCheckInRow } from './habit-checkin-row';
import { HabitProgressBar } from './habit-progress-bar';
import styles from './FocusItem.module.css';

interface HabitHistoryCardProps {
  habit: HabitWithHistory;
  dateKey: string;
  /** Whether this is today's entry - enables full interactive experience */
  isToday?: boolean;
  /** Callback when habit state changes (check-in, skip, undo) */
  onUpdate?: () => void;
}

export function HabitHistoryCard({ habit, dateKey, isToday = false, onUpdate }: HabitHistoryCardProps) {
  // Find check-in for this specific date
  const checkIn = habit.checkIns.find(c => c.date === dateKey);
  
  // For today's entry, check if pending
  const isPending = isToday && isPendingToday(habit, dateKey);
  const remainingSkips = isToday ? getRemainingSkips(habit) : 0;

  // State for tracking UI (time/count modes) - only used for today
  const [currentValue, setCurrentValue] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Timer effect for time-based tracking
  useEffect(() => {
    if (startTime && !isPaused && habit.tracking.mode === 'time' && isToday) {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [startTime, isPaused, habit.tracking.mode, isToday]);

  const handleStart = useCallback(() => {
    setStartTime(Date.now());
    setIsPaused(false);
  }, []);

  const handlePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const handleCheckIn = useCallback(async () => {
    if (!isToday) return;
    try {
      let value: number | boolean;

      if (habit.tracking.mode === 'time') {
        const minutes = Math.floor(elapsedTime / (60 * 1000));
        value = minutes;
      } else if (habit.tracking.mode === 'count') {
        value = currentValue;
      } else {
        value = true;
      }

      const updated = checkInHabit(habit, value, dateKey);
      habitStore.update(updated);
      
      // Reset UI
      setStartTime(null);
      setElapsedTime(0);
      setCurrentValue(0);
      setIsPaused(false);

      if (onUpdate) onUpdate();
    } catch (error) {
      logger.error('Check-in failed', { error }, 'HabitHistoryCard');
    }
  }, [habit, dateKey, isToday, elapsedTime, currentValue, onUpdate]);

  const handleSkip = useCallback(async () => {
    if (!isToday) return;
    try {
      const updated = skipHabitDay(habit, dateKey);
      habitStore.update(updated);
      if (onUpdate) onUpdate();
    } catch (error) {
      logger.error('Skip failed', { error }, 'HabitHistoryCard');
    }
  }, [habit, dateKey, isToday, onUpdate]);

  const handleUndo = useCallback(async () => {
    if (!isToday) return;
    try {
      const updated = undoCheckIn(habit, dateKey);
      habitStore.update(updated);
      if (onUpdate) onUpdate();
    } catch (error) {
      logger.error('Undo failed', { error }, 'HabitHistoryCard');
    }
  }, [habit, dateKey, isToday, onUpdate]);

  const handleIncrement = useCallback(() => {
    setCurrentValue(prev => prev + 1);
  }, []);

  // Render action buttons for today's entry
  const renderTodayActions = () => {
    if (!isToday) return null;

    // Pending - show mode-specific actions
    if (isPending) {
      if (habit.tracking.mode === 'time') {
        if (!startTime) {
          return (
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" leadingVisual={PlayIcon} onClick={handleStart}>
                Start Session
              </Button>
              <Button
                variant="invisible"
                size="small"
                leadingVisual={SkipIcon}
                onClick={handleSkip}
                disabled={remainingSkips === 0}
              >
                Skip
              </Button>
            </Stack>
          );
        } else {
          return (
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" leadingVisual={CheckIcon} onClick={handleCheckIn}>
                Check In
              </Button>
              <Button
                variant="default"
                size="small"
                leadingVisual={isPaused ? PlayIcon : PauseIcon}
                onClick={handlePause}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
            </Stack>
          );
        }
      } else if (habit.tracking.mode === 'count') {
        return (
          <Stack direction="horizontal" gap="condensed">
            <Button variant="default" size="small" onClick={handleIncrement}>
              +1
            </Button>
            <Button variant="primary" size="small" leadingVisual={CheckIcon} onClick={handleCheckIn}>
              Check In
            </Button>
            <Button
              variant="invisible"
              size="small"
              leadingVisual={SkipIcon}
              onClick={handleSkip}
              disabled={remainingSkips === 0}
            >
              Skip
            </Button>
          </Stack>
        );
      } else {
        // Binary mode
        return (
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" leadingVisual={CheckIcon} onClick={handleCheckIn}>
              Yes, Done!
            </Button>
            <Button
              variant="invisible"
              size="small"
              leadingVisual={SkipIcon}
              onClick={handleSkip}
              disabled={remainingSkips === 0}
            >
              Skip
            </Button>
          </Stack>
        );
      }
    }

    return null;
  };

  // Today's card - full interactive experience
  if (isToday && isPending) {
    return (
      <div className={styles.card}>
        <Stack direction="vertical" gap="normal">
          {/* Header with day progress */}
          <Stack direction="horizontal" justify="space-between" align="center">
            <Label size="small" variant="accent">
              <span className={styles.iconInline}>
                <FlameIcon size={12} />
              </span>
              Day {habit.currentDay} of {habit.totalDays}
              {remainingSkips > 0 && ` • ${remainingSkips} skip${remainingSkips === 1 ? '' : 's'} remaining`}
            </Label>
            <Link href="/habits" className={styles.manageLink}>
              <LinkExternalIcon size={12} />
              Manage Habit
            </Link>
          </Stack>

          {/* Title and description */}
          <div>
            <strong className={styles.habitTitle}>{habit.title}</strong>
            {habit.description && (
              <p className={`${styles.description} ${styles.descriptionSpaced}`}>{habit.description}</p>
            )}
          </div>

          {/* Tracking UI */}
          {isToday && isPending && (
            <HabitProgressBar
              habit={habit}
              currentValue={currentValue}
              elapsedTime={elapsedTime}
              isPaused={isPaused}
            />
          )}

          {/* Action buttons */}
          <Stack direction="horizontal" gap="condensed">
            {renderTodayActions()}
          </Stack>
        </Stack>
      </div>
    );
  }

  // Today's card - already completed or historical card
  return (
    <HabitCheckInRow
      habit={habit}
      checkIn={checkIn}
      isToday={isToday}
      isPending={isPending}
      onUndo={isToday && !isPending ? handleUndo : undefined}
    />
  );
}
