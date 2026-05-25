'use client';

import { useCallback, useState } from 'react';
import { useConfirm } from '@primer/react';

import { habitStore } from '@/lib/habits';
import { checkInHabit, skipHabitDay, undoCheckIn } from '@/lib/habits/state-machine';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';

interface HabitActions {
  actionError: string | null;
  dismissError: () => void;
  checkIn: (habit: HabitWithHistory, value: number | boolean) => Promise<void>;
  skip: (habit: HabitWithHistory) => Promise<void>;
  undo: (habit: HabitWithHistory) => Promise<void>;
  stop: (habit: HabitWithHistory) => Promise<void>;
  remove: (habit: HabitWithHistory) => Promise<void>;
}

/**
 * Wraps the five habit mutation actions in a shared try/catch/reload pattern,
 * surfacing the most recent error via {@link HabitActions.actionError}.
 */
export function useHabitActions(reload: () => Promise<void>): HabitActions {
  const confirm = useConfirm();
  const [actionError, setActionError] = useState<string | null>(null);

  const run = useCallback(
    async (op: () => Promise<void>, habitId: string, label: string) => {
      setActionError(null);
      try {
        await op();
        await reload();
      } catch (error) {
        logger.error(`Failed to ${label}`, { error, habitId }, 'HabitsPage');
        setActionError(error instanceof Error ? error.message : 'Action failed. Please try again.');
      }
    },
    [reload],
  );

  const checkIn = useCallback(
    (habit: HabitWithHistory, value: number | boolean) =>
      run(() => habitStore.update(checkInHabit(habit, value)), habit.id, 'check in'),
    [run],
  );

  const skip = useCallback(
    (habit: HabitWithHistory) => run(() => habitStore.update(skipHabitDay(habit)), habit.id, 'skip'),
    [run],
  );

  const undo = useCallback(
    (habit: HabitWithHistory) => run(() => habitStore.update(undoCheckIn(habit)), habit.id, 'undo check-in'),
    [run],
  );

  const stop = useCallback(
    async (habit: HabitWithHistory) => {
      const confirmed = await confirm({
        title: 'Stop Habit',
        content: `Are you sure you want to stop "${habit.title}"? You can always view it in the Stopped Habits section.`,
        confirmButtonContent: 'Stop Habit',
        confirmButtonType: 'danger',
      });
      if (!confirmed) return;
      await run(() => habitStore.update({ ...habit, state: 'abandoned' }), habit.id, 'stop habit');
    },
    [confirm, run],
  );

  const remove = useCallback(
    async (habit: HabitWithHistory) => {
      const confirmed = await confirm({
        title: 'Delete Habit',
        content: `Are you sure you want to delete "${habit.title}"? This action cannot be undone.`,
        confirmButtonContent: 'Delete',
        confirmButtonType: 'danger',
      });
      if (!confirmed) return;
      await run(() => habitStore.delete(habit.id), habit.id, 'delete habit');
    },
    [confirm, run],
  );

  return {
    actionError,
    dismissError: () => setActionError(null),
    checkIn,
    skip,
    undo,
    stop,
    remove,
  };
}
