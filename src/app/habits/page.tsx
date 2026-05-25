/**
 * `/habits` — Server-rendered habits management page.
 *
 * Reads the user's habit collection on the server and partitions it into
 * active/completed/abandoned buckets so the client island can paint
 * immediately. {@link HabitsClient} owns every interaction.
 */

import { redirect } from 'next/navigation';

import { AppHeader } from '@/components/AppHeader';
import { readUserHabits } from '@/lib/habits/server';
import type { HabitWithHistory } from '@/lib/habits/types';
import { requireGuardedRscContext } from '@/lib/security/guard';
import layoutStyles from '@/styles/two-column-layout.module.css';

import { HabitsClient } from './_components/HabitsClient';

function partitionByState(habits: HabitWithHistory[]) {
  const active: HabitWithHistory[] = [];
  const completed: HabitWithHistory[] = [];
  const abandoned: HabitWithHistory[] = [];
  for (const habit of habits) {
    if (habit.state === 'completed') completed.push(habit);
    else if (habit.state === 'abandoned') abandoned.push(habit);
    else active.push(habit);
  }
  return { active, completed, abandoned };
}

export default async function HabitsPage() {
  const ctx = await requireGuardedRscContext('page.view');
  if (!ctx) redirect('/sign-in?callbackUrl=/habits');

  const collection = await readUserHabits();
  const { active, completed, abandoned } = partitionByState(collection.habits);

  return (
    <div className={layoutStyles.root}>
      <AppHeader />
      <HabitsClient initialActive={active} initialCompleted={completed} initialAbandoned={abandoned} />
    </div>
  );
}
