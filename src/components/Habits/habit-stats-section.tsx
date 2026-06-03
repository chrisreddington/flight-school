/**
 * Habit Stats Section Component
 *
 * Displays habit statistics in the sidebar including:
 * - Active habits count
 * - Total check-ins
 * - Current streaks
 * - Completed habits count
 */

import { FlameIcon } from '@primer/octicons-react';
import { Text } from '@primer/react';
import styles from '@/app/habits/habits.module.css';

interface HabitStatsSectionProps {
  activeHabitsCount: number;
  totalCheckIns: number;
  currentStreaks: number;
  totalCompletions: number;
}

export function HabitStatsSection({
  activeHabitsCount,
  totalCheckIns,
  currentStreaks,
  totalCompletions,
}: HabitStatsSectionProps) {
  // A zero stat is muted rather than rendered at full strength so an empty
  // tracker reads as calm guidance instead of a wall of bold zeros.
  const stats = [
    { label: 'Active', value: activeHabitsCount },
    { label: 'Check-ins', value: totalCheckIns },
    { label: 'Streaks', value: currentStreaks },
    { label: 'Completed', value: totalCompletions },
  ];

  return (
    <div className={styles.sidebarCard}>
      <div className={styles.sidebarHeader}>
        <FlameIcon size={20} className={styles.sidebarIcon} />
        <Text as="h2" className={styles.sidebarTitle}>
          Habit Tracker
        </Text>
      </div>
      <p className={styles.sidebarSubtitle}>Build lasting habits</p>

      <div className={styles.statsGrid}>
        {stats.map((stat) => (
          <div key={stat.label} className={styles.statItem}>
            <span className={`${styles.statValue} ${stat.value === 0 ? styles.statValueMuted : ''}`}>{stat.value}</span>
            <span className={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
