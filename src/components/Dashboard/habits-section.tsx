'use client';

import { HabitCard } from '@/components/FocusItem';
import { HabitCreationDialog } from '@/components/Habits/HabitCreationDialog';
import { habitStore } from '@/lib/habits';
import { Banner, Button, Stack } from '@primer/react';
import { PlusIcon } from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import styles from './Dashboard.module.css';

const ACTIVE_HABITS_KEY = ['habits', 'active'] as const;

export function HabitsSection() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const habitsQuery = useQuery({
    queryKey: ACTIVE_HABITS_KEY,
    queryFn: () => habitStore.getActive(),
  });

  const habits = habitsQuery.data ?? [];
  const isLoading = habitsQuery.isPending;
  const loadError = habitsQuery.error ? 'Failed to load habits. Please try again.' : null;

  const refreshHabits = () => {
    queryClient.invalidateQueries({ queryKey: ACTIVE_HABITS_KEY });
  };

  if (isLoading) {
    return (
      <div className={styles.habitsCard}>
        <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', margin: 0 }}>Loading habits...</p>
      </div>
    );
  }

  return (
    <>
      {loadError && <Banner title="Failed to load habits" description={loadError} variant="critical" />}
      {habits.length === 0 ? (
        <div className={styles.habitsCard}>
          <Stack direction="vertical" align="center" gap="normal">
            <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', margin: 0 }}>
              No active habits. Create one to start tracking your consistency!
            </p>
            <Button variant="primary" size="small" leadingVisual={PlusIcon} onClick={() => setIsDialogOpen(true)}>
              Create Habit
            </Button>
          </Stack>
        </div>
      ) : (
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" justify="end">
            <Button variant="primary" size="small" leadingVisual={PlusIcon} onClick={() => setIsDialogOpen(true)}>
              Create Habit
            </Button>
          </Stack>
          {habits.map((habit) => (
            <HabitCard key={habit.id} habit={habit} onUpdate={refreshHabits} />
          ))}
        </Stack>
      )}

      <HabitCreationDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} onCreated={refreshHabits} />
    </>
  );
}
