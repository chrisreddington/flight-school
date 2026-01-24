'use client';

import { HabitCard } from '@/components/FocusItem/HabitCard';
import { HabitCreationDialog } from '@/components/Habits/HabitCreationDialog';
import { habitStore } from '@/lib/habits';
import { logger } from '@/lib/logger';
import { Button, Stack } from '@primer/react';
import { PlusIcon } from '@primer/octicons-react';
import { useEffect, useState } from 'react';
import type { HabitWithHistory } from '@/lib/habits/types';
import styles from './Dashboard.module.css';

export function HabitsSection() {
  const [habits, setHabits] = useState<HabitWithHistory[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadHabits = async () => {
    try {
      const active = await habitStore.getActive();
      setHabits(active);
    } catch (error) {
      logger.error('Failed to load habits', { error }, 'HabitsSection');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadHabits();
  }, []);

  const handleCreated = () => {
    loadHabits();
  };

  const handleUpdate = () => {
    loadHabits();
  };

  if (isLoading) {
    return (
      <div className={styles.habitsCard}>
        <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', margin: 0 }}>
          Loading habits...
        </p>
      </div>
    );
  }

  return (
    <>
      {habits.length === 0 ? (
        <div className={styles.habitsCard}>
          <Stack direction="vertical" align="center" gap="normal">
            <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', margin: 0 }}>
              No active habits. Create one to start tracking your consistency!
            </p>
            <Button 
              variant="primary" 
              size="small"
              leadingVisual={PlusIcon}
              onClick={() => setIsDialogOpen(true)}
            >
              Create Habit
            </Button>
          </Stack>
        </div>
      ) : (
        <Stack direction="vertical" gap="normal">
          <Stack direction="horizontal" justify="end">
            <Button 
              variant="primary" 
              size="small"
              leadingVisual={PlusIcon}
              onClick={() => setIsDialogOpen(true)}
            >
              Create Habit
            </Button>
          </Stack>
          {habits.map(habit => (
            <HabitCard 
              key={habit.id} 
              habit={habit}
              onUpdate={handleUpdate}
            />
          ))}
        </Stack>
      )}

      <HabitCreationDialog 
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
