/**
 * Habit Card Component
 * 
 * Displays a user-created habit with streak tracking and daily check-ins.
 * Supports three tracking modes: time, count, and binary.
 */

import { habitStore } from '@/lib/habits';
import { checkInHabit, isPendingToday, getRemainingSkips, skipHabitDay, undoCheckIn } from '@/lib/habits/state-machine';
import type { HabitWithHistory } from '@/lib/habits/types';
import { getDateKey } from '@/lib/utils/date-utils';
import { logger } from '@/lib/logger';
import { CheckIcon, FlameIcon, KebabHorizontalIcon, PauseIcon, PencilIcon, PlayIcon, SkipIcon, StopIcon, TrashIcon, UndoIcon } from '@primer/octicons-react';
import { ActionList, ActionMenu, Button, Heading, IconButton, Label, ProgressBar, Stack, useConfirm } from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import { HabitEditDialog } from '../Habits/HabitEditDialog';
import styles from './FocusItem.module.css';

interface HabitCardProps {
  habit: HabitWithHistory;
  onUpdate?: () => void;
  onDelete?: () => void;
}

export function HabitCard({ habit, onUpdate, onDelete }: HabitCardProps) {
  const [currentValue, setCurrentValue] = useState<number>(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState<boolean>(false);
  
  const confirm = useConfirm();

  const dateKey = getDateKey();
  const isPending = isPendingToday(habit, dateKey);
  const remainingSkips = getRemainingSkips(habit);

  // Timer effect for time-based tracking
  useEffect(() => {
    if (startTime && !isPaused && habit.tracking.mode === 'time') {
      const interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [startTime, isPaused, habit.tracking.mode]);

  const handleStart = useCallback(() => {
    setStartTime(Date.now());
    setIsPaused(false);
  }, []);

  const handlePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  const handleCheckIn = useCallback(async () => {
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
      logger.error('Check-in failed', { error }, 'HabitCard');
    }
  }, [habit, elapsedTime, currentValue, dateKey, onUpdate]);

  const handleSkip = useCallback(async () => {
    try {
      const updated = skipHabitDay(habit, dateKey);
      habitStore.update(updated);
      if (onUpdate) onUpdate();
    } catch (error) {
      logger.error('Skip failed', { error }, 'HabitCard');
    }
  }, [habit, dateKey, onUpdate]);

  const handleUndo = useCallback(async () => {
    try {
      const updated = undoCheckIn(habit, dateKey);
      habitStore.update(updated);
      if (onUpdate) onUpdate();
    } catch (error) {
      logger.error('Undo failed', { error }, 'HabitCard');
    }
  }, [habit, dateKey, onUpdate]);

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Delete habit?',
      content: `Are you sure you want to delete "${habit.title}"? This action cannot be undone.`,
      confirmButtonContent: 'Delete',
      confirmButtonType: 'danger',
    });

    if (confirmed) {
      try {
        await habitStore.delete(habit.id);
        logger.info('Habit deleted', { habitId: habit.id }, 'HabitCard');
        if (onDelete) onDelete();
        if (onUpdate) onUpdate();
      } catch (error) {
        logger.error('Delete failed', { error }, 'HabitCard');
      }
    }
  }, [habit, confirm, onDelete, onUpdate]);

  const handleStop = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Stop habit?',
      content: `Are you sure you want to stop "${habit.title}"? You can view it later in Stopped Habits.`,
      confirmButtonContent: 'Stop Habit',
      confirmButtonType: 'danger',
    });

    if (confirmed) {
      try {
        const updated: HabitWithHistory = { ...habit, state: 'abandoned' };
        await habitStore.update(updated);
        logger.info('Habit stopped', { habitId: habit.id }, 'HabitCard');
        if (onUpdate) onUpdate();
      } catch (error) {
        logger.error('Stop failed', { error }, 'HabitCard');
      }
    }
  }, [habit, confirm, onUpdate]);

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

  // Render tracking UI based on mode
  const renderTrackingUI = () => {
    if (habit.tracking.mode === 'time') {
      const config = habit.tracking;
      const elapsedMinutes = elapsedTime / (60 * 1000);
      const timeProgress = Math.min((elapsedMinutes / config.minMinutes) * 100, 100);
      const isGoalReached = elapsedMinutes >= config.minMinutes;

      return (
        <>
          <Stack direction="horizontal" justify="space-between">
            <span className={styles.progressLabel}>
              {isGoalReached ? 'Goal Reached!' : 'Today\'s Session:'}
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
        </>
      );
    } else if (habit.tracking.mode === 'count') {
      const config = habit.tracking;
      const countProgress = Math.min((currentValue / config.target) * 100, 100);

      return (
        <>
          <Stack direction="horizontal" justify="space-between">
            <span className={styles.progressLabel}>Today&apos;s Progress:</span>
            <span className={styles.progressValue}>
              {currentValue}/{config.target} {config.unit}
            </span>
          </Stack>
          <ProgressBar
            progress={countProgress}
            bg={currentValue >= config.target ? 'var(--bgColor-success-muted)' : 'var(--bgColor-accent-muted)'}
          />
        </>
      );
    } else {
      // Binary mode - just yes/no
      return (
        <p className={styles.description}>Did you complete this today?</p>
      );
    }
  };

  // Render action buttons based on mode
  const renderActions = () => {
    if (!isPending) {
      // Allow undo of today's check-in
      return (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Label variant="success" size="large">
            ✓ Checked in today
          </Label>
          <Button variant="invisible" size="small" leadingVisual={UndoIcon} onClick={handleUndo}>
            Undo
          </Button>
        </Stack>
      );
    }

    if (habit.tracking.mode === 'time') {
      if (!startTime) {
        return (
          <Button variant="primary" leadingVisual={PlayIcon} onClick={handleStart}>
            Start Session
          </Button>
        );
      } else {
        return (
          <>
            <Button variant="primary" leadingVisual={CheckIcon} onClick={handleCheckIn}>
              Check In
            </Button>
            <Button
              variant="default"
              leadingVisual={isPaused ? PlayIcon : PauseIcon}
              onClick={handlePause}
              size="small"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
          </>
        );
      }
    } else if (habit.tracking.mode === 'count') {
      return (
        <>
          <Button variant="default" onClick={handleIncrement}>
            +1
          </Button>
          <Button variant="primary" leadingVisual={CheckIcon} onClick={handleCheckIn}>
            Check In
          </Button>
        </>
      );
    } else {
      // Binary mode
      return (
        <Button variant="primary" leadingVisual={CheckIcon} onClick={handleCheckIn} size="large">
          Yes, Done!
        </Button>
      );
    }
  };

  // Render streak visualization
  const renderStreak = () => {
    const days = Array.from({ length: habit.totalDays }, (_, i) => {
      const dayNumber = i + 1; // Days are 1-indexed
      
      // Check if we've reached this day yet
      if (dayNumber > habit.currentDay) {
        return { symbol: '○', filled: false }; // Future day
      }
      
      // Find check-in for this day (match by day number, not date)
      // Days are sequential from start, so day 1 = first check-in, day 2 = second, etc.
      const checkIn = habit.checkIns[i];
      
      if (!checkIn) {
        return { symbol: '○', filled: false }; // No check-in yet
      }
      
      // Show ✓ for any check-in (celebrating showing up!)
      // Only show ○ if explicitly skipped (value === false)
      if (checkIn.value === false) {
        return { symbol: '○', filled: false }; // Skipped
      } else {
        return { symbol: '✓', filled: true }; // Checked in!
      }
    });

    return (
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', fontSize: '14px' }}>
        {days.map((day, dayIndex) => (
          <span key={`${habit.id}-day-${dayIndex}`} style={{ opacity: day.filled ? 1 : 0.3 }}>
            {day.symbol}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Label size="small" variant="accent">
            <span style={{ marginRight: '4px', display: 'inline-flex' }}>
              <FlameIcon size={12} />
            </span>
            Day {habit.currentDay} of {habit.totalDays}
            {remainingSkips > 0 && ` • ${remainingSkips} skip remaining`}
          </Label>
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton icon={KebabHorizontalIcon} aria-label="Habit actions" variant="invisible" size="small" />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay>
              <ActionList>
                <ActionList.Item onSelect={() => setIsEditDialogOpen(true)}>
                  <ActionList.LeadingVisual><PencilIcon /></ActionList.LeadingVisual>
                  Edit
                </ActionList.Item>
                <ActionList.Divider />
                <ActionList.Item onSelect={handleStop}>
                  <ActionList.LeadingVisual><StopIcon /></ActionList.LeadingVisual>
                  Stop Habit
                </ActionList.Item>
                <ActionList.Item variant="danger" onSelect={handleDelete}>
                  <ActionList.LeadingVisual><TrashIcon /></ActionList.LeadingVisual>
                  Delete
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </Stack>

        <Heading as="h3">{habit.title}</Heading>
        <p className={styles.description}>{habit.description}</p>

        {isPending && <div>{renderTrackingUI()}</div>}

        <div>
          <span className={styles.progressLabel}>Streak:</span>
          {renderStreak()}
        </div>

        <Stack direction="horizontal" gap="condensed">
          {renderActions()}
          {isPending && (
            <Button
              variant="invisible"
              leadingVisual={SkipIcon}
              onClick={handleSkip}
              disabled={remainingSkips === 0}
              size="small"
            >
              Skip Today
            </Button>
          )}
        </Stack>

        {habit.state === 'completed' && (
          <Label variant="success" size="large">
            🎉 Habit Complete!
          </Label>
        )}
      </Stack>

      <HabitEditDialog
        habit={habit}
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        onUpdated={onUpdate}
      />
    </div>
  );
}
