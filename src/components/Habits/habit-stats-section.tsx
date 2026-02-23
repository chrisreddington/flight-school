/**
 * Habit Stats Section Component
 *
 * Displays habit statistics in the sidebar including:
 * - Active habits count
 * - Total check-ins
 * - Current streaks
 * - Completed habits count
 */

import { FlameIcon, PlusIcon } from '@primer/octicons-react';
import { Button } from '@primer/react';
import styles from '@/app/habits/habits.module.css';

interface HabitStatsSectionProps {
  activeHabitsCount: number;
  totalCheckIns: number;
  currentStreaks: number;
  totalCompletions: number;
  onNewHabitClick: () => void;
}

export function HabitStatsSection({
  activeHabitsCount,
  totalCheckIns,
  currentStreaks,
  totalCompletions,
  onNewHabitClick,
}: HabitStatsSectionProps) {
  return (
    <div className={styles.sidebarCard}>
      <div className={styles.sidebarHeader}>
        <FlameIcon size={20} className={styles.sidebarIcon} />
        <h2 className={styles.sidebarTitle}>Habit Tracker</h2>
      </div>
      <p className={styles.sidebarSubtitle}>Build lasting habits</p>

      <div className={styles.statsGrid}>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{activeHabitsCount}</span>
          <span className={styles.statLabel}>Active</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{totalCheckIns}</span>
          <span className={styles.statLabel}>Check-ins</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{currentStreaks}</span>
          <span className={styles.statLabel}>Streaks</span>
        </div>
        <div className={styles.statItem}>
          <span className={styles.statValue}>{totalCompletions}</span>
          <span className={styles.statLabel}>Completed</span>
        </div>
      </div>

      {activeHabitsCount > 0 && (
        <Button
          variant="primary"
          leadingVisual={PlusIcon}
          onClick={onNewHabitClick}
          style={{ marginTop: 'var(--base-size-16, 16px)', width: '100%' }}
        >
          New Habit
        </Button>
      )}
    </div>
  );
}
