'use client';

import { updateHabitAction } from '@/app/habits/actions';
import type { HabitWithHistory } from '@/lib/habits/types';
import { logger } from '@/lib/logger';
import {
  Banner,
  Dialog,
  FormControl,
  Stack,
  TextInput,
  Textarea,
} from '@primer/react';
import { useCallback, useState } from 'react';

interface HabitEditDialogProps {
  habit: HabitWithHistory;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

/**
 * Modal for editing an existing habit's title/description. Tracking
 * configuration is immutable to preserve check-in history; the
 * informational banner in the dialog explains that constraint.
 */
export function HabitEditDialog({ habit, isOpen, onClose, onUpdated }: HabitEditDialogProps) {
  const [title, setTitle] = useState(habit.title);
  const [description, setDescription] = useState(habit.description);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const updated: HabitWithHistory = {
        ...habit,
        title: title.trim(),
        description: description.trim(),
      };
      const result = await updateHabitAction(updated);
      if (!result.ok) {
        setError(result.error ?? 'Failed to save changes. Please try again.');
        return;
      }
      logger.info('Habit updated', { habitId: habit.id }, 'HabitEditDialog');
      if (onUpdated) onUpdated();
      onClose();
    } catch (err) {
      logger.error('Failed to update habit', { error: err }, 'HabitEditDialog');
      setError('Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [habit, isSaving, title, description, onUpdated, onClose]);

  const handleClose = useCallback(() => {
    // Reset form state on close
    setTitle(habit.title);
    setDescription(habit.description);
    setError(null);
    onClose();
  }, [habit, onClose]);

  if (!isOpen) return null;

  return (
    <Dialog
      title="Edit Habit"
      subtitle="Update your habit details"
      onClose={handleClose}
      width="medium"
      footerButtons={[
        {
          buttonType: 'default',
          content: 'Cancel',
          onClick: handleClose,
        },
        {
          buttonType: 'primary',
          content: isSaving ? 'Saving...' : 'Save Changes',
          onClick: handleSave,
          disabled: isSaving || !title.trim(),
        },
      ]}
    >
      <Stack direction="vertical" gap="normal">
        {error && (
          <Banner
            title="Error"
            description={error}
            variant="critical"
          />
        )}

        <FormControl required>
          <FormControl.Label>Title</FormControl.Label>
          <TextInput
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Daily CI focus"
            block
          />
        </FormControl>

        <FormControl>
          <FormControl.Label>Description</FormControl.Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What will you accomplish?"
            rows={3}
            block
          />
        </FormControl>

        <Banner
          title="Why can't I change other settings?"
          hideTitle
          description="Tracking mode, duration, and other settings cannot be changed once a habit is started. This preserves the integrity of your check-in history. If you need different settings, create a new habit instead."
          variant="info"
        />
      </Stack>
    </Dialog>
  );
}
