/**
 * useSkillsProfile
 *
 * Owns the user's skill-profile state plus every mutator the Skills page
 * needs: load, change level/interest, add, add-from-suggestion, remove,
 * and the destructive "clear all data" reset.
 *
 * @remarks
 * Each mutator is optimistic with rollback on storage error; the latest
 * persisted `SkillProfile` is what tests/UI observe via `profile`.
 * `calibrationItems` is loaded alongside the profile because the same
 * `useEffect` already pulls both stores in parallel.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import { challengeQueueStore } from '@/lib/challenge/custom-queue';
import { focusStore } from '@/lib/focus/storage';
import type { CalibrationNeededItem } from '@/lib/focus/types';
import { habitStore } from '@/lib/habits/storage';
import { logger } from '@/lib/logger';
import { skillsStore } from '@/lib/skills/storage';
import type { SkillLevel, SkillProfile, UserSkill } from '@/lib/skills/types';
import { DEFAULT_SKILL_PROFILE } from '@/lib/skills/types';
import { threadStore } from '@/lib/threads/storage';
import { now } from '@/lib/utils/date-utils';
import { workspaceStore } from '@/lib/workspace/storage';

export interface UseSkillsProfileResult {
  profile: SkillProfile;
  isLoading: boolean;
  loadError: string | null;
  actionError: string | null;
  setActionError: (msg: string | null) => void;
  calibrationItems: CalibrationNeededItem[];
  handleCalibrationChange: (items: CalibrationNeededItem[]) => Promise<void>;
  handleSkillChange: (skillId: string, level: SkillLevel, notInterested: boolean) => Promise<void>;
  handleRemoveSkill: (skillId: string) => Promise<void>;
  handleAddSkill: (suggested?: { skillId: string; displayName: string }, displayNameOverride?: string) => Promise<void>;
  handleClearAllData: () => Promise<void>;
}

export function useSkillsProfile(options?: { initialProfile?: SkillProfile }): UseSkillsProfileResult {
  const initialProfile = options?.initialProfile;
  const [profile, setProfile] = useState<SkillProfile>(initialProfile ?? DEFAULT_SKILL_PROFILE);
  // Server-Component seeded loads start non-blocking — the profile is already
  // visible, only the (light) calibration query is still in flight.
  const [isLoading, setIsLoading] = useState(!initialProfile);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [calibrationItems, setCalibrationItems] = useState<CalibrationNeededItem[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setLoadError(null);
        if (initialProfile) {
          // Profile was server-rendered; only calibration still needs fetching.
          const calibration = await focusStore.getCalibrationNeeded();
          setCalibrationItems(calibration);
          return;
        }
        const [loaded, calibration] = await Promise.all([
          skillsStore.get(),
          focusStore.getCalibrationNeeded(),
        ]);
        setProfile(loaded);
        setCalibrationItems(calibration);
      } catch (error) {
        logger.error('Failed to load skill profile', { error }, 'SkillsPage');
        setLoadError('Failed to load skill profile. Please try refreshing the page.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [initialProfile]);

  const handleCalibrationChange = useCallback(async (items: CalibrationNeededItem[]) => {
    setCalibrationItems(items);
    // Reload profile in case a skill was confirmed by accepting a calibration item.
    try {
      const loaded = await skillsStore.get();
      setProfile(loaded);
    } catch {
      // Best effort — the visible profile still reflects what was persisted.
    }
  }, []);

  const handleSkillChange = useCallback(
    async (skillId: string, level: SkillLevel, notInterested: boolean) => {
      setActionError(null);
      const updatedSkills = profile.skills.map((skill) => {
        if (skill.skillId !== skillId) return skill;
        // Preserve provenance: GitHub-detected skills become 'github-confirmed' on edit.
        const source =
          skill.source === 'github' || skill.source === 'github-confirmed'
            ? ('github-confirmed' as const)
            : ('manual' as const);
        return { ...skill, level, notInterested, source };
      });

      const updatedProfile: SkillProfile = { skills: updatedSkills, lastUpdated: now() };
      setProfile(updatedProfile);

      try {
        await skillsStore.save(updatedProfile);
      } catch (error) {
        logger.error('Failed to save skill profile', { error }, 'SkillsPage');
        setProfile(profile);
        setActionError(error instanceof Error ? error.message : 'Failed to save changes. Please try again.');
      }
    },
    [profile],
  );

  const handleRemoveSkill = useCallback(
    async (skillId: string) => {
      setActionError(null);
      const updatedSkills = profile.skills.filter((skill) => skill.skillId !== skillId);
      const updatedProfile: SkillProfile = { skills: updatedSkills, lastUpdated: now() };
      setProfile(updatedProfile);

      try {
        await skillsStore.save(updatedProfile);
      } catch (error) {
        logger.error('Failed to remove skill', { error }, 'SkillsPage');
        setProfile(profile);
        setActionError(error instanceof Error ? error.message : 'Failed to save changes. Please try again.');
      }
    },
    [profile],
  );

  const handleAddSkill = useCallback(
    async (suggested?: { skillId: string; displayName: string }, displayNameOverride?: string) => {
      setActionError(null);

      const displayName = suggested ? suggested.displayName : (displayNameOverride ?? '').trim();
      if (!displayName) return;

      const skillId = suggested ? suggested.skillId : displayName.toLowerCase().replace(/\s+/g, '-');
      if (profile.skills.some((s) => s.skillId === skillId)) return;

      const newSkill: UserSkill = { skillId, displayName, level: 'beginner', source: 'manual' };
      const updatedProfile: SkillProfile = {
        skills: [...profile.skills, newSkill],
        lastUpdated: now(),
      };
      setProfile(updatedProfile);

      try {
        await skillsStore.save(updatedProfile);
      } catch (error) {
        logger.error('Failed to add skill', { error }, 'SkillsPage');
        setProfile(profile);
        setActionError(error instanceof Error ? error.message : 'Failed to save changes. Please try again.');
      }
    },
    [profile],
  );

  const handleClearAllData = useCallback(async () => {
    // Each store is cleared independently so a single failure doesn't block
    // the rest of the wipe. Best-effort: errors are logged but not surfaced.
    const stores: Array<{ name: string; clear: () => Promise<void> }> = [
      { name: 'skills', clear: () => skillsStore.clear() },
      { name: 'focus', clear: () => focusStore.clear() },
      { name: 'threads', clear: () => threadStore.clearAll() },
      { name: 'workspaces', clear: () => workspaceStore.clearAll() },
      { name: 'habits', clear: () => habitStore.clear() },
      { name: 'challenge queue', clear: () => challengeQueueStore.clear() },
    ];

    for (const { name, clear } of stores) {
      try {
        await clear();
      } catch (error) {
        logger.error(`Failed to clear ${name} storage`, { error }, 'SkillsPage');
      }
    }

    window.location.href = '/';
  }, []);

  return {
    profile,
    isLoading,
    loadError,
    actionError,
    setActionError,
    calibrationItems,
    handleCalibrationChange,
    handleSkillChange,
    handleRemoveSkill,
    handleAddSkill,
    handleClearAllData,
  };
}
