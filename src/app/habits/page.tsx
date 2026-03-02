/**
 * Habits Management Page
 *
 * Dedicated page for viewing and managing all habits.
 * Shows active habits, completed habits, and overall statistics.
 */

'use client';

import { AppHeader } from '@/components/AppHeader';
import { HabitCreationDialog } from '@/components/Habits/HabitCreationDialog';
import { HabitEditDialog } from '@/components/Habits/HabitEditDialog';
import { HabitStatsSection } from '@/components/Habits/habit-stats-section';
import { HabitListSection } from '@/components/Habits/habit-list-section';
import { ProfileNav } from '@/components/ProfileNav';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { habitStore } from '@/lib/habits';
import {
  checkInHabit,
  skipHabitDay,
  undoCheckIn,
} from '@/lib/habits/state-machine';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import {
  LightBulbIcon,
} from '@primer/octicons-react';
import {
  Banner,
  Heading,
  Spinner,
  Stack,
  Text,
  useConfirm,
} from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import styles from './habits.module.css';

export default function HabitsPage() {
  useBreadcrumb('/habits', 'Habits', '/habits');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeHabits, setActiveHabits] = useState<HabitWithHistory[]>([]);
  const [completedHabits, setCompletedHabits] = useState<HabitWithHistory[]>([]);
  const [abandonedHabits, setAbandonedHabits] = useState<HabitWithHistory[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithHistory | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const confirm = useConfirm();

  const loadHabits = useCallback(async () => {
    try {
      setLoadError(null);
      const [active, completed, abandoned] = await Promise.all([
        habitStore.getActive(),
        habitStore.getCompleted(),
        habitStore.getAbandoned(),
      ]);
      setActiveHabits(active);
      setCompletedHabits(completed);
      setAbandonedHabits(abandoned);
    } catch (error) {
      logger.error('Failed to load habits', { error }, 'HabitsPage');
      setLoadError('Failed to load habits. Please try refreshing the page.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  const handleCheckIn = useCallback(
    async (habit: HabitWithHistory, value: number | boolean) => {
      setActionError(null);
      try {
        const updated = checkInHabit(habit, value);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to check in', { error, habitId: habit.id }, 'HabitsPage');
        setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
      }
    },
    [loadHabits]
  );

  const handleSkip = useCallback(
    async (habit: HabitWithHistory) => {
      setActionError(null);
      try {
        const updated = skipHabitDay(habit);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to skip', { error, habitId: habit.id }, 'HabitsPage');
        setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
      }
    },
    [loadHabits]
  );

  const handleUndo = useCallback(
    async (habit: HabitWithHistory) => {
      setActionError(null);
      try {
        const updated = undoCheckIn(habit);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to undo check-in', { error, habitId: habit.id }, 'HabitsPage');
        setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
      }
    },
    [loadHabits]
  );

  const handleDelete = useCallback(
    async (habit: HabitWithHistory) => {
      setActionError(null);
      const confirmed = await confirm({
        title: 'Delete Habit',
        content: `Are you sure you want to delete "${habit.title}"? This action cannot be undone.`,
        confirmButtonContent: 'Delete',
        confirmButtonType: 'danger',
      });

      if (confirmed) {
        try {
          await habitStore.delete(habit.id);
          await loadHabits();
          logger.info('Habit deleted', { habitId: habit.id }, 'HabitsPage');
        } catch (error) {
          logger.error('Failed to delete habit', { error, habitId: habit.id }, 'HabitsPage');
          setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
        }
      }
    },
    [confirm, loadHabits]
  );

  const handleStop = useCallback(
    async (habit: HabitWithHistory) => {
      setActionError(null);
      const confirmed = await confirm({
        title: 'Stop Habit',
        content: `Are you sure you want to stop "${habit.title}"? You can always view it in the Stopped Habits section.`,
        confirmButtonContent: 'Stop Habit',
        confirmButtonType: 'danger',
      });

      if (confirmed) {
        try {
          const updated: HabitWithHistory = { ...habit, state: 'abandoned' };
          await habitStore.update(updated);
          await loadHabits();
          logger.info('Habit stopped', { habitId: habit.id }, 'HabitsPage');
        } catch (error) {
          logger.error('Failed to stop habit', { error, habitId: habit.id }, 'HabitsPage');
          setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
        }
      }
    },
    [confirm, loadHabits]
  );

  // Calculate statistics
  const totalCheckIns = [...activeHabits, ...completedHabits].reduce(
    (sum, h) => sum + h.checkIns.length,
    0
  );
  const totalCompletions = completedHabits.length;
  const currentStreaks = activeHabits.filter((h) => h.currentDay > 0).length;

  if (isLoading) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <aside className={styles.sidebar}>
            <ProfileNav />
            <div className={styles.sidebarCard}>
              <Spinner size="medium" />
            </div>
          </aside>
          <div className={styles.content}>
            <Stack align="center" justify="center" style={{ flex: 1, padding: '48px' }}>
              <Spinner size="large" />
              <Text>Loading habits...</Text>
            </Stack>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        {/* Left Sidebar */}
        <aside className={styles.sidebar}>
          <ProfileNav />

          <HabitStatsSection
            activeHabitsCount={activeHabits.length}
            totalCheckIns={totalCheckIns}
            currentStreaks={currentStreaks}
            totalCompletions={totalCompletions}
            onNewHabitClick={() => setIsCreateDialogOpen(true)}
          />

          <div className={`${styles.sidebarCard} ${styles.tipCard}`}>
            <h3 className={styles.tipTitle}>
              <LightBulbIcon size={12} /> Pro Tip
            </h3>
            <p className={styles.tipText}>
              Start small! It&apos;s easier to build a habit with a 5-minute daily commitment than an hour-long one.
            </p>
          </div>
        </aside>

        {/* Main Content */}
        <div className={styles.content}>
          {/* Header */}
          <div className={styles.header}>
            <Heading as="h1">My Habits</Heading>
            <Text as="p" style={{ color: 'var(--fgColor-muted)', marginTop: '4px' }}>
              Track your progress and build lasting habits
            </Text>
          </div>

          {loadError && (
            <Banner
              title="Failed to load habits"
              description={loadError}
              variant="critical"
            />
          )}
          {actionError && (
            <Banner
              title="Action failed"
              description={actionError}
              variant="critical"
              onDismiss={() => setActionError(null)}
            />
          )}

          <HabitListSection
            activeHabits={activeHabits}
            completedHabits={completedHabits}
            abandonedHabits={abandonedHabits}
            onCheckIn={handleCheckIn}
            onSkip={handleSkip}
            onUndo={handleUndo}
            onEdit={setEditingHabit}
            onStop={handleStop}
            onDelete={handleDelete}
            onNewHabitClick={() => setIsCreateDialogOpen(true)}
          />
        </div>
      </main>

      {/* Dialogs */}
      <HabitCreationDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreated={loadHabits}
      />

      {editingHabit && (
        <HabitEditDialog
          habit={editingHabit}
          isOpen={true}
          onClose={() => setEditingHabit(null)}
          onUpdated={loadHabits}
        />
      )}
    </div>
  );
}
