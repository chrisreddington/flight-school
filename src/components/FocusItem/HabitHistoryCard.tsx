/**
 * Habit History Card
 * 
 * Shows a single day's check-in status for a habit.
 * Different from HabitCard - this is a read-only historical view.
 */

import type { HabitWithHistory } from '@/lib/habits/types';
import { CheckIcon, SkipIcon, CircleIcon } from '@primer/octicons-react';
import { Label, Stack } from '@primer/react';
import styles from './FocusItem.module.css';

interface HabitHistoryCardProps {
  habit: HabitWithHistory;
  dateKey: string;
}

export function HabitHistoryCard({ habit, dateKey }: HabitHistoryCardProps) {
  // Find check-in for this specific date
  const checkIn = habit.checkIns.find(c => c.date === dateKey);
  
  // Determine status
  let icon: React.ReactNode;
  let statusText: string;
  let labelVariant: 'success' | 'secondary' | 'default';
  let showProgress = false;

  if (!checkIn) {
    icon = <CircleIcon size={16} />;
    statusText = 'Not checked in';
    labelVariant = 'default';
  } else if (checkIn.value === false) {
    // Explicitly skipped (Skip Today button)
    icon = <SkipIcon size={16} />;
    statusText = 'Skipped';
    labelVariant = 'secondary';
  } else {
    // Checked in! Celebrate showing up
    icon = <CheckIcon size={16} />;
    statusText = checkIn.completed ? '✓ Target reached!' : '✓ Checked in';
    labelVariant = checkIn.completed ? 'success' : 'success';
    showProgress = true;
  }

  // Format value display
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
