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
import { ProfileNav } from '@/components/ProfileNav';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { habitStore } from '@/lib/habits';
import {
  checkInHabit,
  isPendingToday,
  skipHabitDay,
  undoCheckIn,
  getRemainingSkips,
} from '@/lib/habits/state-machine';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import {
  CheckCircleIcon,
  ClockIcon,
  FlameIcon,
  GraphIcon,
  KebabHorizontalIcon,
  LightBulbIcon,
  PencilIcon,
  PlusIcon,
  SkipIcon,
  StopIcon,
  TrashIcon,
  UndoIcon,
} from '@primer/octicons-react';
import {
  ActionList,
  ActionMenu,
  Button,
  CounterLabel,
  Heading,
  IconButton,
  Label,
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
  const [activeHabits, setActiveHabits] = useState<HabitWithHistory[]>([]);
  const [completedHabits, setCompletedHabits] = useState<HabitWithHistory[]>([]);
  const [abandonedHabits, setAbandonedHabits] = useState<HabitWithHistory[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<HabitWithHistory | null>(null);
  const confirm = useConfirm();

  const loadHabits = useCallback(async () => {
    try {
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
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHabits();
  }, [loadHabits]);

  const handleCheckIn = useCallback(
    async (habit: HabitWithHistory, value: number | boolean) => {
      try {
        const updated = checkInHabit(habit, value);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to check in', { error, habitId: habit.id }, 'HabitsPage');
      }
    },
    [loadHabits]
  );

  const handleSkip = useCallback(
    async (habit: HabitWithHistory) => {
      try {
        const updated = skipHabitDay(habit);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to skip', { error, habitId: habit.id }, 'HabitsPage');
      }
    },
    [loadHabits]
  );

  const handleUndo = useCallback(
    async (habit: HabitWithHistory) => {
      try {
        const updated = undoCheckIn(habit);
        await habitStore.update(updated);
        await loadHabits();
      } catch (error) {
        logger.error('Failed to undo check-in', { error, habitId: habit.id }, 'HabitsPage');
      }
    },
    [loadHabits]
  );

  const handleDelete = useCallback(
    async (habit: HabitWithHistory) => {
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
        }
      }
    },
    [confirm, loadHabits]
  );

  const handleStop = useCallback(
    async (habit: HabitWithHistory) => {
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

  const getTrackingLabel = (mode: 'time' | 'count' | 'binary'): string => {
    switch (mode) {
      case 'time':
        return 'Time-based';
      case 'count':
        return 'Count-based';
      case 'binary':
        return 'Yes/No';
      default:
        return mode;
    }
  };

  const getStateLabel = (habit: HabitWithHistory) => {
    switch (habit.state) {
      case 'active':
        return <Label variant="success">Active</Label>;
      case 'not-started':
        return <Label variant="secondary">Not Started</Label>;
      case 'paused':
        return <Label variant="attention">Paused</Label>;
      case 'completed':
        return <Label variant="done">Completed</Label>;
      case 'abandoned':
        return <Label variant="danger">Abandoned</Label>;
      default:
        return null;
    }
  };

  const renderHabitCard = (habit: HabitWithHistory, showActions = true) => {
    const isPending = isPendingToday(habit);
    const hasCheckedIn = !isPending && habit.currentDay > 0;
    const progress = (habit.currentDay / habit.totalDays) * 100;
    const remainingSkips = getRemainingSkips(habit);

    return (
      <div key={habit.id} className={styles.habitCard}>
        <div className={styles.habitCardHeader}>
          <div className={styles.habitCardInfo}>
            <div className={styles.habitTitle}>{habit.title}</div>
            {habit.description && (
              <div className={styles.habitDescription}>{habit.description}</div>
            )}
          </div>

          <Stack direction="horizontal" gap="condensed" align="center">
            {getStateLabel(habit)}

            {showActions && (
              <ActionMenu>
                <ActionMenu.Anchor>
                  <IconButton
                    icon={KebabHorizontalIcon}
                    variant="invisible"
                    aria-label="Habit options"
                    size="small"
                  />
                </ActionMenu.Anchor>
                <ActionMenu.Overlay>
                  <ActionList>
                    <ActionList.Item onSelect={() => setEditingHabit(habit)}>
                      <ActionList.LeadingVisual>
                        <PencilIcon />
                      </ActionList.LeadingVisual>
                      Edit
                    </ActionList.Item>
                    <ActionList.Divider />
                    <ActionList.Item onSelect={() => handleStop(habit)}>
                      <ActionList.LeadingVisual>
                        <StopIcon />
                      </ActionList.LeadingVisual>
                      Stop Habit
                    </ActionList.Item>
                    <ActionList.Item variant="danger" onSelect={() => handleDelete(habit)}>
                      <ActionList.LeadingVisual>
                        <TrashIcon />
                      </ActionList.LeadingVisual>
                      Delete
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            )}
          </Stack>
        </div>

        <div className={styles.habitMeta}>
          <Label size="small">
            <ClockIcon size={12} /> {habit.totalDays} days
          </Label>
          <Label size="small">{getTrackingLabel(habit.tracking.mode)}</Label>
          <Label size="small">
            Day {habit.currentDay}/{habit.totalDays}
          </Label>
          {habit.allowedSkips > 0 && (
            <Label size="small" variant={remainingSkips === 0 ? 'attention' : 'secondary'}>
              <SkipIcon size={12} /> {remainingSkips} skip{remainingSkips !== 1 ? 's' : ''} left
            </Label>
          )}
        </div>

        {habit.state !== 'completed' && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${progress}%` }} />
          </div>
        )}

        {showActions && habit.state === 'active' && (
          <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
            {isPending && (
              <>
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={CheckCircleIcon}
                  onClick={() => handleCheckIn(habit, true)}
                >
                  Complete Today
                </Button>
                {remainingSkips > 0 && (
                  <Button
                    size="small"
                    variant="invisible"
                    leadingVisual={SkipIcon}
                    onClick={() => handleSkip(habit)}
                  >
                    Skip
                  </Button>
                )}
              </>
            )}
            {hasCheckedIn && (
              <>
                <Label variant="success">
                  <CheckCircleIcon size={12} /> Checked in today
                </Label>
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={UndoIcon}
                  onClick={() => handleUndo(habit)}
                >
                  Undo
                </Button>
              </>
            )}
          </Stack>
        )}
      </div>
    );
  };

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

          <div className={styles.sidebarCard}>
            <div className={styles.sidebarHeader}>
              <FlameIcon size={20} className={styles.sidebarIcon} />
              <h2 className={styles.sidebarTitle}>Habit Tracker</h2>
            </div>
            <p className={styles.sidebarSubtitle}>Build lasting habits</p>
            
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <span className={styles.statValue}>{activeHabits.length}</span>
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

            <Button
              variant="primary"
              leadingVisual={PlusIcon}
              onClick={() => setIsCreateDialogOpen(true)}
              style={{ marginTop: 'var(--base-size-16, 16px)', width: '100%' }}
            >
              New Habit
            </Button>
          </div>

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

          {/* Active Habits */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <Stack direction="horizontal" gap="condensed" align="center">
                <FlameIcon size={20} />
                <Heading as="h2" style={{ fontSize: '1.25rem' }}>
                  Active Habits
                </Heading>
                <CounterLabel>{activeHabits.length}</CounterLabel>
              </Stack>
            </div>

            {activeHabits.length === 0 ? (
              <div className={styles.emptyState}>
                <FlameIcon size={48} className={styles.emptyIcon} />
                <Heading as="h3" style={{ fontSize: '1.125rem', marginTop: 'var(--base-size-16)' }}>
                  No active habits
                </Heading>
                <Text as="p" style={{ color: 'var(--fgColor-muted)', marginTop: 'var(--base-size-8)' }}>
                  Start building better habits by creating your first one.
                </Text>
                <Button
                  variant="primary"
                  style={{ marginTop: 'var(--base-size-16)' }}
                  onClick={() => setIsCreateDialogOpen(true)}
                >
                  Create a Habit
                </Button>
              </div>
            ) : (
              <div className={styles.habitsList}>
                {activeHabits.map((habit) => renderHabitCard(habit))}
              </div>
            )}
          </section>

          {/* Completed Habits */}
          {completedHabits.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <GraphIcon size={20} />
                  <Heading as="h2" style={{ fontSize: '1.25rem' }}>
                    Completed Habits
                  </Heading>
                  <CounterLabel>{completedHabits.length}</CounterLabel>
                </Stack>
              </div>

              <div className={styles.habitsList}>
                {completedHabits.map((habit) => renderHabitCard(habit, false))}
              </div>
            </section>
          )}

          {/* Abandoned/Stopped Habits */}
          {abandonedHabits.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <Stack direction="horizontal" gap="condensed" align="center">
                  <StopIcon size={20} />
                  <Heading as="h2" style={{ fontSize: '1.25rem' }}>
                    Stopped Habits
                  </Heading>
                  <CounterLabel>{abandonedHabits.length}</CounterLabel>
                </Stack>
              </div>

              <div className={styles.habitsList}>
                {abandonedHabits.map((habit) => renderHabitCard(habit, false))}
              </div>
            </section>
          )}
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
