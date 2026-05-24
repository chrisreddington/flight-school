'use client';

/**
 * Interactive shell for `/habits`. The Server Component renders the page
 * chrome and hands down the initial habit collection; this island wires up
 * all mutations, dialogs, and re-fetch on completion.
 */

import { LightBulbIcon } from '@primer/octicons-react';
import { Banner, Heading, Spinner, Stack, Text } from '@primer/react';
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

import { HabitListSection } from '@/components/Habits/habit-list-section';
import { HabitStatsSection } from '@/components/Habits/habit-stats-section';
import { ProfileNav } from '@/components/ProfileNav';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { useHabitActions } from '@/hooks/use-habit-actions';
import { habitStore } from '@/lib/habits';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import layoutStyles from '@/styles/two-column-layout.module.css';
import styles from '../habits.module.css';

const HabitCreationDialog = dynamic(
  () => import('@/components/Habits/HabitCreationDialog').then(m => ({ default: m.HabitCreationDialog })),
  { ssr: false }
);
const HabitEditDialog = dynamic(
  () => import('@/components/Habits/HabitEditDialog').then(m => ({ default: m.HabitEditDialog })),
  { ssr: false }
);

interface HabitsClientProps {
  initialActive: HabitWithHistory[];
  initialCompleted: HabitWithHistory[];
  initialAbandoned: HabitWithHistory[];
}

export function HabitsClient({ initialActive, initialCompleted, initialAbandoned }: HabitsClientProps) {
  useBreadcrumb('/habits', 'Habits', '/habits');

  const [loadError, setLoadError] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [activeHabits, setActiveHabits] = useState(initialActive);
  const [completedHabits, setCompletedHabits] = useState(initialCompleted);
  const [abandonedHabits, setAbandonedHabits] = useState(initialAbandoned);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithHistory | null>(null);

  const loadHabits = useCallback(async () => {
    setIsReloading(true);
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
      logger.error('Failed to load habits', { error }, 'HabitsClient');
      setLoadError('Failed to load habits. Please try refreshing the page.');
    } finally {
      setIsReloading(false);
    }
  }, []);

  const actions = useHabitActions(loadHabits);

  const totalCheckIns = [...activeHabits, ...completedHabits].reduce(
    (sum, h) => sum + h.checkIns.length,
    0
  );

  return (
    <>
      <main className={layoutStyles.main}>
        <aside className={layoutStyles.sidebar}>
          <ProfileNav />

          <HabitStatsSection
            activeHabitsCount={activeHabits.length}
            totalCheckIns={totalCheckIns}
            currentStreaks={activeHabits.filter((h) => h.currentDay > 0).length}
            totalCompletions={completedHabits.length}
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

          {isReloading && (
            <Stack direction="horizontal" align="center" gap="condensed">
              <Spinner size="small" /> <span>Refreshing…</span>
            </Stack>
          )}

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
    </>
  );
}
