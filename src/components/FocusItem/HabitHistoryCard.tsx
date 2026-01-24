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
import { CheckIcon, SkipIcon, CircleIcon, UndoIcon, FlameIcon, PlayIcon, PauseIcon, LinkExternalIcon } from '@primer/octicons-react';
import { Button, Label, Link, ProgressBar, Stack } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
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
  
  // Determine status for display
  let icon: React.ReactNode;
  let statusText: string;
  let labelVariant: 'success' | 'secondary' | 'default';
  let showProgress = false;

  if (!checkIn) {
    icon = <CircleIcon size={16} />;
    statusText = isToday && isPending ? 'In Progress' : 'Not checked in';
    labelVariant = 'default';
  } else if (checkIn.value === false) {
    icon = <SkipIcon size={16} />;
    statusText = 'Skipped';
    labelVariant = 'secondary';
  } else {
    icon = <CheckIcon size={16} />;
    statusText = checkIn.completed ? '✓ Target reached!' : '✓ Checked in';
    labelVariant = 'success';
    showProgress = true;
  }

  // Format value display for completed check-ins
  const getValueDisplay = () => {
    if (!checkIn) return null;
    
    if (habit.tracking.mode === 'time' && typeof checkIn.value === 'number') {
      return `${checkIn.value} min`;
    } else if (habit.tracking.mode === 'count' && typeof checkIn.value === 'number') {
      const config = habit.tracking;
      return `${checkIn.value}/${config.target} ${config.unit}`;
    }
    return null;
  };

  const valueDisplay = getValueDisplay();

  // Render tracking UI for today's pending habit
  const renderTrackingUI = () => {
    if (!isToday || !isPending) return null;

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
                <span style={{ color: 'var(--fgColor-success)' }}>
                  {formatTime(elapsedTime)} / {config.minMinutes} min ✓
                </span>
              ) : (
                <>
                  {formatTime(elapsedTime)} / {config.minMinutes} min
                </>
              )}
              {isPaused && <span style={{ color: 'var(--fgColor-muted)' }}> (Paused)</span>}
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
  };

  // Render action buttons for today's entry
  const renderTodayActions = () => {
    if (!isToday) return null;

    // Already checked in - show undo option
    if (!isPending && checkIn && checkIn.value !== false) {
      return (
        <Button variant="invisible" size="small" leadingVisual={UndoIcon} onClick={handleUndo}>
          Undo
        </Button>
      );
    }

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
              <span style={{ marginRight: '4px', display: 'inline-flex' }}>
                <FlameIcon size={12} />
              </span>
              Day {habit.currentDay} of {habit.totalDays}
              {remainingSkips > 0 && ` • ${remainingSkips} skip${remainingSkips === 1 ? '' : 's'} remaining`}
            </Label>
            <Link href="/habits" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <LinkExternalIcon size={12} />
              Manage Habit
            </Link>
          </Stack>

          {/* Title and description */}
          <div>
            <strong style={{ fontSize: '16px' }}>{habit.title}</strong>
            {habit.description && (
              <p className={styles.description} style={{ marginTop: '4px' }}>{habit.description}</p>
            )}
          </div>

          {/* Tracking UI */}
          {renderTrackingUI()}

          {/* Action buttons */}
          <Stack direction="horizontal" gap="condensed">
            {renderTodayActions()}
          </Stack>
        </Stack>
      </div>
    );
  }

  // Today's card - already completed
  if (isToday && !isPending) {
    return (
      <div className={styles.card} style={{ padding: '12px 16px' }}>
        <Stack direction="vertical" gap="condensed">
          <Stack direction="horizontal" justify="space-between" align="center">
            <Stack direction="horizontal" gap="condensed" align="center">
              <span style={{ display: 'inline-flex' }}>
                {icon}
              </span>
              <div>
                <strong>{habit.title}</strong>
                {showProgress && valueDisplay && (
                  <span style={{ marginLeft: '8px', color: 'var(--fgColor-muted)', fontSize: '14px' }}>
                    {valueDisplay}
                    {checkIn?.completed && ' 🎉'}
                  </span>
                )}
              </div>
            </Stack>
            <Stack direction="horizontal" gap="condensed" align="center">
              {renderTodayActions()}
              <Label variant={labelVariant} size="small">
                {statusText}
              </Label>
            </Stack>
          </Stack>
          <Stack direction="horizontal" justify="space-between" align="center">
            <span style={{ fontSize: '12px', color: 'var(--fgColor-muted)' }}>
              Day {habit.currentDay} of {habit.totalDays}
            </span>
            <Link href="/habits" style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <LinkExternalIcon size={12} />
              Manage Habit
            </Link>
          </Stack>
        </Stack>
      </div>
    );
  }

  // Historical card - read-only
  return (
    <div className={styles.card} style={{ padding: '12px 16px' }}>
      <Stack direction="horizontal" justify="space-between" align="center">
        <Stack direction="horizontal" gap="condensed" align="center">
          <span style={{ display: 'inline-flex', opacity: !checkIn ? 0.5 : 1 }}>
            {icon}
          </span>
          <div>
            <strong>{habit.title}</strong>
            {showProgress && valueDisplay && (
              <span style={{ marginLeft: '8px', color: 'var(--fgColor-muted)', fontSize: '14px' }}>
                {valueDisplay}
                {checkIn?.completed && ' 🎉'}
              </span>
            )}
          </div>
        </Stack>
        <Label variant={labelVariant} size="small">
          {statusText}
        </Label>
      </Stack>
    </div>
  );
}
