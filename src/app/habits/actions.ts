'use server';

/**
 * Server Actions for `/habits`. Every mutation goes through the same
 * guarded write path used by the storage-route factory — the action just
 * removes the HTTP hop between the form and the disk.
 */

import { revalidatePath } from 'next/cache';

import { readUserHabits } from '@/lib/habits/server';
import {
  MAX_ACTIVE_HABITS,
  createHabit,
  createHabitWithHistory,
  type Habit,
  type HabitCollection,
  type HabitWithHistory,
  type TrackingConfig,
} from '@/lib/habits/types';
import { requireGuardedUserContext } from '@/lib/security/guard';
import { writeUserStorage } from '@/lib/storage/user-storage';

const HABITS_FILENAME = 'habits.json';

const HABITS_ACTION_GUARD = {
  eventType: 'storage.write' as const,
  auditMetadata: { route: '/habits' },
};

function isHabitCollection(data: unknown): data is HabitCollection {
  if (typeof data !== 'object' || data === null) return false;
  return Array.isArray((data as Record<string, unknown>).habits);
}

/** Serialized payload sent from {@link HabitCreationDialog} to the action. */
export interface CreateHabitPayload {
  title: string;
  description: string;
  tracking: TrackingConfig;
  activeDays: number;
  includesWeekends: boolean;
}

export interface HabitActionResult {
  ok: boolean;
  habit?: HabitWithHistory;
  error?: string;
}

/**
 * Persists a brand-new habit for the authenticated user. Re-validates the
 * payload server-side as defense-in-depth — the dialog's client validation
 * is for UX, not security.
 */
export async function createHabitAction(payload: CreateHabitPayload): Promise<HabitActionResult> {
  const { release } = await requireGuardedUserContext({
    ...HABITS_ACTION_GUARD,
    auditMetadata: { ...HABITS_ACTION_GUARD.auditMetadata, action: 'createHabit' },
  });
  try {
    const title = payload.title.trim();
    const description = payload.description.trim();
    if (!title) return { ok: false, error: 'Title is required' };
    if (!description) return { ok: false, error: 'Description is required' };
    if (payload.activeDays <= 0) return { ok: false, error: 'Duration must be a positive number' };
    if (payload.activeDays > 365) return { ok: false, error: 'Duration cannot exceed 365 days' };

    const habit: Habit = createHabit(
      title,
      description,
      payload.tracking,
      payload.activeDays,
      payload.includesWeekends,
    );

    const collection = await readUserHabits();
    const activeCount = collection.habits.filter(
      (existing) => existing.state === 'not-started' || existing.state === 'active' || existing.state === 'paused',
    ).length;
    if (activeCount >= MAX_ACTIVE_HABITS) {
      return { ok: false, error: `You can have at most ${MAX_ACTIVE_HABITS} active habits.` };
    }

    const habitWithHistory = createHabitWithHistory(habit);
    const next: HabitCollection = { ...collection, habits: [...collection.habits, habitWithHistory] };
    await writeUserStorage(HABITS_FILENAME, next, isHabitCollection);
    revalidatePath('/habits');
    return { ok: true, habit: habitWithHistory };
  } finally {
    release();
  }
}

/**
 * Persists an edited habit. The dialog already trimmed/validated fields;
 * we re-check the title/description requirement server-side.
 */
export async function updateHabitAction(habit: HabitWithHistory): Promise<HabitActionResult> {
  const { release } = await requireGuardedUserContext({
    ...HABITS_ACTION_GUARD,
    auditMetadata: { ...HABITS_ACTION_GUARD.auditMetadata, action: 'updateHabit' },
  });
  try {
    if (!habit.title?.trim() || !habit.description?.trim()) {
      return { ok: false, error: 'Title and description are required' };
    }
    const collection = await readUserHabits();
    const index = collection.habits.findIndex((h) => h.id === habit.id);
    if (index === -1) return { ok: false, error: `Habit ${habit.id} not found` };
    const updated = [...collection.habits];
    updated[index] = habit;
    await writeUserStorage(HABITS_FILENAME, { ...collection, habits: updated }, isHabitCollection);
    revalidatePath('/habits');
    return { ok: true, habit };
  } finally {
    release();
  }
}
