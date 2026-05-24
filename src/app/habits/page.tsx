'use client';

/**
 * Habits Management Page
 *
 * Dedicated page for viewing and managing all habits.
 * Shows active habits, completed habits, and overall statistics.
 */

import { LightBulbIcon } from '@primer/octicons-react';
import { Banner, Heading, Spinner, Stack, Text } from '@primer/react';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { HabitListSection } from '@/components/Habits/habit-list-section';
import { HabitStatsSection } from '@/components/Habits/habit-stats-section';
import { ProfileNav } from '@/components/ProfileNav';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useHabitActions } from '@/hooks/use-habit-actions';
import { habitStore } from '@/lib/habits';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import layoutStyles from '@/styles/two-column-layout.module.css';
import styles from './habits.module.css';

// Lazy-load dialog components — they are only needed on first user interaction,
// so we defer their JS chunk until the user opens a dialog.
const HabitCreationDialog = dynamic(
  () => import('@/components/Habits/HabitCreationDialog').then(m => ({ default: m.HabitCreationDialog })),
  { ssr: false }
);
const HabitEditDialog = dynamic(
  () => import('@/components/Habits/HabitEditDialog').then(m => ({ default: m.HabitEditDialog })),
  { ssr: false }
);

export default function HabitsPage() {
  useBreadcrumb('/habits', 'Habits', '/habits');

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeHabits, setActiveHabits] = useState<HabitWithHistory[]>([]);
  const [completedHabits, setCompletedHabits] = useState<HabitWithHistory[]>([]);
  const [abandonedHabits, setAbandonedHabits] = useState<HabitWithHistory[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithHistory | null>(null);

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

  useEffect(() => { loadHabits(); }, [loadHabits]);

  const actions = useHabitActions(loadHabits);

  const totalCheckIns = [...activeHabits, ...completedHabits].reduce(
    (sum, h) => sum + h.checkIns.length,
    0
  );
  const totalCompletions = completedHabits.length;
  const currentStreaks = activeHabits.filter((h) => h.currentDay > 0).length;

  if (isLoading) {
    return (
      <div className={layoutStyles.root}>
        <AppHeader />
        <main className={layoutStyles.main}>
          <aside className={layoutStyles.sidebar}>
            <ProfileNav />
            <div className={layoutStyles.sidebarCard}><Spinner size="medium" /></div>
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
    <div className={layoutStyles.root}>
      <AppHeader />

      <main className={layoutStyles.main}>
        <aside className={layoutStyles.sidebar}>
          <ProfileNav />

          <HabitStatsSection
            activeHabitsCount={activeHabits.length}
            totalCheckIns={totalCheckIns}
            currentStreaks={currentStreaks}
            totalCompletions={totalCompletions}
            onNewHabitClick={() => setIsCreateDialogOpen(true)}
          />

          <div className={`${layoutStyles.sidebarCard} ${styles.tipCard}`}>
            <p className={styles.tipTitle}>
              <LightBulbIcon size={12} /> Pro Tip
            </p>
            <p className={styles.tipText}>
              Start small! It&apos;s easier to build a habit with a 5-minute daily commitment than an hour-long one.
            </p>
          </div>
        </aside>

        <div className={styles.content}>
          <div className={styles.header}>
            <Heading as="h1">My Habits</Heading>
            <Text as="p" style={{ color: 'var(--fgColor-muted)', marginTop: '4px' }}>
              Track your progress and build lasting habits
            </Text>
          </div>

          {loadError && (
            <Banner title="Failed to load habits" description={loadError} variant="critical" />
          )}
          {actions.actionError && (
            <Banner
              title="Action failed"
              description={actions.actionError}
              variant="critical"
              onDismiss={actions.dismissError}
            />
          )}

          <HabitListSection
            activeHabits={activeHabits}
            completedHabits={completedHabits}
            abandonedHabits={abandonedHabits}
            onCheckIn={actions.checkIn}
            onSkip={actions.skip}
            onUndo={actions.undo}
            onEdit={setEditingHabit}
            onStop={actions.stop}
            onDelete={actions.remove}
            onNewHabitClick={() => setIsCreateDialogOpen(true)}
          />
        </div>
      </main>

      {/* Dialogs — rendered conditionally so their chunks load on first use */}
      {isCreateDialogOpen && (
        <HabitCreationDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onCreated={loadHabits}
        />
      )}

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
