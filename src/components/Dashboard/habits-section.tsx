'use client';

import { HabitCard } from '@/components/FocusItem/HabitCard';
import { HabitCreationDialog } from '@/components/Habits/HabitCreationDialog';
import { habitStore } from '@/lib/habits';
import { logger } from '@/lib/logger';
import { Button, Heading, Stack } from '@primer/react';
import { PlusIcon } from '@primer/octicons-react';
import { useEffect, useState } from 'react';
import type { HabitWithHistory } from '@/lib/habits/types';

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
      <Stack direction="vertical" gap="normal">
        <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', padding: '32px' }}>
          Loading habits...
        </p>
      </Stack>
    );
  }

  return (
    <>
      <Stack direction="vertical" gap="normal">
        <Stack direction="horizontal" justify="space-between" align="center">
          <Heading as="h2">Your Habits</Heading>
          <Button 
            variant="primary" 
            size="small"
            leadingVisual={PlusIcon}
            onClick={() => setIsDialogOpen(true)}
          >
            Create Habit
          </Button>
        </Stack>

        {habits.length === 0 ? (
          <p style={{ color: 'var(--fgColor-muted)', textAlign: 'center', padding: '32px' }}>
            No active habits. Create one to start tracking your consistency!
          </p>
        ) : (
          habits.map(habit => (
            <HabitCard 
              key={habit.id} 
              habit={habit}
              onUpdate={handleUpdate}
            />
          ))
        )}
      </Stack>

      <HabitCreationDialog 
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
