/**
 * Habit Check-in Row Component
 * 
 * Compact display of a habit check-in status - used for historical entries
 * and completed today entries.
 */

import type { DailyCheckIn, HabitWithHistory } from '@/lib/habits/types';
import { CheckIcon, CircleIcon, LinkExternalIcon, SkipIcon, UndoIcon } from '@primer/octicons-react';
import { Button, Label, Link, Stack } from '@primer/react';
import styles from './FocusItem.module.css';

interface HabitCheckInRowProps {
  habit: HabitWithHistory;
  checkIn: DailyCheckIn | undefined;
  isToday: boolean;
  isPending: boolean;
  onUndo?: () => void;
}

export function HabitCheckInRow({ habit, checkIn, isToday, isPending, onUndo }: HabitCheckInRowProps) {
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

  // Today's completed card
  if (isToday && !isPending) {
    return (
      <div className={`${styles.card} ${styles.cardCompact}`}>
        <Stack direction="vertical" gap="condensed">
          <Stack direction="horizontal" justify="space-between" align="center">
            <Stack direction="horizontal" gap="condensed" align="center">
              <span className={styles.iconWrapper}>
                {icon}
              </span>
              <div>
                <strong>{habit.title}</strong>
                {showProgress && valueDisplay && (
                  <span className={styles.valueDisplay}>
                    {valueDisplay}
                    {checkIn?.completed && ' 🎉'}
                  </span>
                )}
              </div>
            </Stack>
            <Stack direction="horizontal" gap="condensed" align="center">
              {onUndo && checkIn && checkIn.value !== false && (
                <Button variant="invisible" size="small" leadingVisual={UndoIcon} onClick={onUndo}>
                  Undo
                </Button>
              )}
              <Label variant={labelVariant} size="small">
                {statusText}
              </Label>
            </Stack>
          </Stack>
          <Stack direction="horizontal" justify="space-between" align="center">
            <span className={styles.smallMuted}>
              Day {habit.currentDay} of {habit.totalDays}
            </span>
            <Link href="/habits" className={styles.manageLink}>
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
    <div className={`${styles.card} ${styles.cardCompact}`}>
      <Stack direction="horizontal" justify="space-between" align="center">
        <Stack direction="horizontal" gap="condensed" align="center">
          <span className={styles.iconWrapper} style={{ opacity: !checkIn ? 0.5 : 1 }}>
            {icon}
          </span>
          <div>
            <strong>{habit.title}</strong>
            {showProgress && valueDisplay && (
              <span className={styles.valueDisplay}>
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
