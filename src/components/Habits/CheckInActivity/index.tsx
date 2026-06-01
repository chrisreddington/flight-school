import type { HabitWithHistory } from '@/lib/habits/types';
import { getDateKey } from '@/lib/utils/date-utils';
import { Text } from '@primer/react';
import styles from './check-in-activity.module.css';

const DEFAULT_ACTIVITY_DAYS = 30;
const LEGEND_LEVELS = [styles.level0, styles.level1, styles.level2, styles.level3, styles.level4];

/** Props for the habit check-in activity heatmap. */
export interface CheckInActivityProps {
  habits: HabitWithHistory[];
  days?: number;
}

interface ActivityDay {
  dateKey: string;
  completedCount: number;
}

function buildActivityDateKeys(today: Date, days: number): string[] {
  const activityDateKeys: string[] = [];

  for (let dayOffset = days - 1; dayOffset >= 0; dayOffset -= 1) {
    const activityDate = new Date(today);
    activityDate.setDate(today.getDate() - dayOffset);
    activityDateKeys.push(getDateKey(activityDate));
  }

  return activityDateKeys;
}

function countCompletedCheckInsByDate(habits: HabitWithHistory[], activityDateKeys: string[]): Map<string, number> {
  const activityDateSet = new Set(activityDateKeys);
  const completedCountsByDate = new Map(activityDateKeys.map((dateKey) => [dateKey, 0]));

  for (const habit of habits) {
    const completedDatesForHabit = new Set<string>();

    for (const checkIn of habit.checkIns) {
      if (checkIn.completed && activityDateSet.has(checkIn.date)) {
        completedDatesForHabit.add(checkIn.date);
      }
    }

    for (const completedDate of completedDatesForHabit) {
      const previousCompletedCount = completedCountsByDate.get(completedDate) ?? 0;
      completedCountsByDate.set(completedDate, previousCompletedCount + 1);
    }
  }

  return completedCountsByDate;
}

function intensityClassForCount(completedCount: number): string {
  if (completedCount >= 4) {
    return styles.level4;
  }

  if (completedCount === 3) {
    return styles.level3;
  }

  if (completedCount === 2) {
    return styles.level2;
  }

  if (completedCount === 1) {
    return styles.level1;
  }

  return styles.level0;
}

function checkInLabel(completedCount: number): string {
  if (completedCount === 1) {
    return '1 check-in';
  }

  return `${completedCount} check-ins`;
}

/** Renders a GitHub-style activity heatmap for recent habit check-ins. */
export function CheckInActivity({ habits, days = DEFAULT_ACTIVITY_DAYS }: CheckInActivityProps) {
  const today = new Date();
  const activityDateKeys = buildActivityDateKeys(today, days);
  const completedCountsByDate = countCompletedCheckInsByDate(habits, activityDateKeys);
  const activityDays: ActivityDay[] = activityDateKeys.map((dateKey) => ({
    dateKey,
    completedCount: completedCountsByDate.get(dateKey) ?? 0,
  }));
  const totalCompleted = activityDays.reduce(
    (completedTotal, activityDay) => completedTotal + activityDay.completedCount,
    0,
  );
  const hasNoCompletedCheckIns = habits.length === 0 || totalCompleted === 0;

  return (
    <section className={styles.card} aria-labelledby="check-in-activity-title">
      <div className={styles.header}>
        <Text as="h2" id="check-in-activity-title" className={styles.title}>
          Check-in activity
        </Text>
        <Text className={styles.subtitle}>Last {days} days</Text>
      </div>

      <div className={styles.grid} role="group" aria-label={`${totalCompleted} check-ins in the last ${days} days`}>
        {activityDays.map((activityDay) => {
          const dayLabel = `${activityDay.dateKey}: ${checkInLabel(activityDay.completedCount)}`;

          return (
            <span
              key={activityDay.dateKey}
              className={`${styles.dayCell} ${intensityClassForCount(activityDay.completedCount)}`}
              role="img"
              title={dayLabel}
              aria-label={dayLabel}
            />
          );
        })}
      </div>

      <div className={styles.legend} aria-label="Activity intensity legend">
        <Text className={styles.legendLabel}>Less</Text>
        {LEGEND_LEVELS.map((levelClassName) => (
          <span key={levelClassName} className={`${styles.legendSwatch} ${levelClassName}`} aria-hidden="true" />
        ))}
        <Text className={styles.legendLabel}>More</Text>
      </div>

      {hasNoCompletedCheckIns && (
        <Text className={styles.emptyMessage}>No check-ins yet — complete a habit to start your streak.</Text>
      )}
    </section>
  );
}
