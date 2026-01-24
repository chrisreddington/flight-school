/**
 * Skill Profile Page
 *
 * User-facing skill calibration interface. Allows users to review
 * and adjust their skill levels for personalized learning recommendations.
 *
 * @remarks
 * This page displays skills detected from GitHub activity and allows
 * users to manually calibrate their proficiency levels.
 */

'use client';

import { AppHeader } from '@/components/AppHeader';
import { InlineCalibration } from '@/components/Dashboard/inline-calibration';
import { SkillSlider } from '@/components/SkillSlider';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { challengeQueueStore } from '@/lib/challenge/custom-queue';
import { focusStore } from '@/lib/focus/storage';
import type { CalibrationNeededItem } from '@/lib/focus/types';
import { habitStore } from '@/lib/habits/storage';
import { logger } from '@/lib/logger';
import { skillsStore } from '@/lib/skills/storage';
import type { SkillLevel, SkillProfile, SkillSource, UserSkill } from '@/lib/skills/types';
import { DEFAULT_SKILL_PROFILE, SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS, SKILL_SOURCE_LABELS } from '@/lib/skills/types';
import { threadStore } from '@/lib/threads/storage';
import { now } from '@/lib/utils/date-utils';
import { workspaceStore } from '@/lib/workspace/storage';
import { AlertIcon, InfoIcon, PlusIcon, TrashIcon } from '@primer/octicons-react';
import {
    Button,
    Flash,
    FormControl,
    Heading,
    Link,
    Spinner,
    Stack,
    TextInput,
} from '@primer/react';
import { useCallback, useEffect, useState } from 'react';
import styles from './profile-skills.module.css';

/**
 * Skill Profile Page Component
 */
export default function SkillProfilePage() {
  const [profile, setProfile] = useState<SkillProfile>(DEFAULT_SKILL_PROFILE);
  const [isLoading, setIsLoading] = useState(true);
  const [newSkillName, setNewSkillName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [calibrationItems, setCalibrationItems] = useState<CalibrationNeededItem[]>([]);

  // Register this page in breadcrumb history
  useBreadcrumb('/profile/skills', 'Skill Profile', '/profile/skills');

  // Load profile and calibration items on mount
  useEffect(() => {
    (async () => {
      try {
        const [loaded, calibration] = await Promise.all([
          skillsStore.get(),
          focusStore.getCalibrationNeeded(),
        ]);
        setProfile(loaded);
        setCalibrationItems(calibration);
      } catch (error) {
        logger.error('Failed to load skill profile', { error }, 'SkillsPage');
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Handle calibration item changes (from InlineCalibration)
  // Reload profile when items change (a skill may have been confirmed)
  const handleCalibrationChange = useCallback(async (items: CalibrationNeededItem[]) => {
    setCalibrationItems(items);
    // Reload profile in case a skill was confirmed
    try {
      const loaded = await skillsStore.get();
      setProfile(loaded);
    } catch {
      // Best effort
    }
  }, []);

  // Handle skill level and interest change
  const handleSkillChange = useCallback(async (skillId: string, level: SkillLevel, notInterested: boolean) => {
    if (!profile) return;
    
    const updatedSkills = profile.skills.map(skill =>
      skill.skillId === skillId
        ? { ...skill, level, notInterested, source: 'manual' as const }
        : skill
    );
    
    const updatedProfile: SkillProfile = {
      skills: updatedSkills,
      lastUpdated: now(),
    };
    
    // Optimistic update
    setProfile(updatedProfile);
    
    try {
      await skillsStore.save(updatedProfile);
    } catch (error) {
      logger.error('Failed to save skill profile', { error }, 'SkillsPage');
      // Revert on error
      setProfile(profile);
    }
  }, [profile]);

  // Handle removing a skill
  const handleRemoveSkill = useCallback(async (skillId: string) => {
    if (!profile) return;
    
    const updatedSkills = profile.skills.filter(skill => skill.skillId !== skillId);
    
    const updatedProfile: SkillProfile = {
      skills: updatedSkills,
      lastUpdated: now(),
    };
    
    // Optimistic update
    setProfile(updatedProfile);
    
    try {
      await skillsStore.save(updatedProfile);
    } catch (error) {
      logger.error('Failed to remove skill', { error }, 'SkillsPage');
      // Revert on error
      setProfile(profile);
    }
  }, [profile]);

  // Handle adding a new skill
  const handleAddSkill = useCallback(async () => {
    if (!profile || !newSkillName.trim()) return;
    
    const skillId = newSkillName.toLowerCase().replace(/\s+/g, '-');
    
    // Check if skill already exists
    if (profile.skills.some(s => s.skillId === skillId)) {
      return;
    }
    
    const newSkill: UserSkill = {
      skillId,
      displayName: newSkillName.trim(),
      level: 'beginner',
      source: 'manual',
    };
    
    const updatedProfile: SkillProfile = {
      skills: [...profile.skills, newSkill],
      lastUpdated: now(),
    };
    
    // Optimistic update
    setProfile(updatedProfile);
    setNewSkillName('');
    setShowAddForm(false);
    
    try {
      await skillsStore.save(updatedProfile);
    } catch (error) {
      logger.error('Failed to add skill', { error }, 'SkillsPage');
      // Revert on error
      setProfile(profile);
    }
  }, [profile, newSkillName]);

  // Handle clearing all app data
  const handleClearAllData = useCallback(async () => {
    // Clear skills storage
    try {
      await skillsStore.clear();
    } catch (error) {
      logger.error('Failed to clear skills storage', { error }, 'SkillsPage');
    }

    // Clear focus storage
    try {
      await focusStore.clear();
    } catch (error) {
      logger.error('Failed to clear focus storage', { error }, 'SkillsPage');
    }

    // Clear chat threads
    try {
      await threadStore.clearAll();
    } catch (error) {
      logger.error('Failed to clear threads storage', { error }, 'SkillsPage');
    }

    // Clear workspaces
    try {
      await workspaceStore.clearAll();
    } catch (error) {
      logger.error('Failed to clear workspaces storage', { error }, 'SkillsPage');
    }

    // Clear habits
    try {
      await habitStore.clear();
    } catch (error) {
      logger.error('Failed to clear habits storage', { error }, 'SkillsPage');
    }

    // Clear custom challenge queue
    try {
      await challengeQueueStore.clear();
    } catch (error) {
      logger.error('Failed to clear challenge queue', { error }, 'SkillsPage');
    }

    // Reload page to reset app state
    window.location.href = '/';
  }, []);

  if (isLoading) {
    return (
      <div className={styles.root}>
        <AppHeader />
        <main className={styles.main}>
          <div className={styles.content}>
            <Stack direction="horizontal" align="center" justify="center" gap="condensed">
              <Spinner size="medium" />
              <span>Loading skill profile...</span>
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
        <div className={styles.content}>
          <Stack direction="vertical" gap="normal">
            <div className={styles.pageHeader}>
              <Heading as="h1" className={styles.pageTitle}>
                Skill Profile
              </Heading>
              <p className={styles.pageDescription}>
                Calibrate your skill levels for personalized learning recommendations.
                These settings help us tailor challenges and topics to your experience level.
              </p>
            </div>

            <div className={styles.infoBox}>
              <Stack direction="horizontal" align="start" gap="condensed">
                <InfoIcon size={16} className={styles.infoIcon} />
                <p className={styles.infoText}>
                  Skills are initially detected from your GitHub activity. You can adjust
                  levels here to calibrate your recommendations.
                </p>
              </Stack>
            </div>

            {calibrationItems.length > 0 && (
              <InlineCalibration 
                items={calibrationItems} 
                onItemsChange={handleCalibrationChange}
                showProfileLink={false}
              />
            )}

            <div className={styles.levelLegend}>
              <Heading as="h3" className={styles.legendTitle}>Skill Levels</Heading>
              <Stack direction="vertical" gap="condensed">
                {(['beginner', 'intermediate', 'advanced'] as SkillLevel[]).map(level => (
                  <div key={level} className={styles.legendItem}>
                    <span className={styles.legendLevel}>{SKILL_LEVEL_LABELS[level]}</span>
                    <span className={styles.legendDescription}>{SKILL_LEVEL_DESCRIPTIONS[level]}</span>
                  </div>
                ))}
                <div className={styles.legendItem}>
                  <span className={styles.legendLevel}>Not interested</span>
                  <span className={styles.legendDescription}>Deprioritised in recommendations and daily focus</span>
                </div>
              </Stack>
            </div>

            <div className={styles.skillsSection}>
              <Stack direction="horizontal" align="center" justify="space-between" className={styles.skillsHeader}>
                <Heading as="h2" className={styles.skillsTitle}>
                  Your Skills ({profile?.skills.length || 0})
                </Heading>
                <Button
                  variant="primary"
                  size="small"
                  leadingVisual={PlusIcon}
                  onClick={() => setShowAddForm(true)}
                >
                  Add Skill
                </Button>
              </Stack>

              {showAddForm && (
                <div className={styles.addSkillForm}>
                  <FormControl>
                    <FormControl.Label>Skill Name</FormControl.Label>
                    <Stack direction="horizontal" gap="condensed">
                      <TextInput
                        value={newSkillName}
                        onChange={(e) => setNewSkillName(e.target.value)}
                        placeholder="e.g., TypeScript, React, Docker"
                        aria-label="New skill name"
                      />
                      <Button onClick={handleAddSkill} disabled={!newSkillName.trim()}>
                        Add
                      </Button>
                      <Button variant="invisible" onClick={() => setShowAddForm(false)}>
                        Cancel
                      </Button>
                    </Stack>
                  </FormControl>
                </div>
              )}

              {profile?.skills.length === 0 ? (
                <div className={styles.emptyState}>
                  <p>
                    No skills configured yet. Skills will be detected automatically from your
                    GitHub activity, or you can add them manually.
                  </p>
                  <Link href="/">Return to Dashboard</Link>
                </div>
              ) : (
                <Stack direction="vertical" gap="normal" className={styles.skillsList}>
                  {profile?.skills.map(skill => (
                    <div key={skill.skillId} className={styles.skillCard}>
                      <Stack direction="horizontal" align="start" justify="space-between" gap="normal">
                        <div className={styles.skillInfo}>
                          <span className={styles.skillName}>
                            {skill.displayName || skill.skillId}
                          </span>
                          <span className={styles.skillSource}>
                            {SKILL_SOURCE_LABELS[skill.source as SkillSource] || skill.source}
                          </span>
                        </div>
                        <Stack direction="horizontal" align="start" gap="condensed">
                          <SkillSlider
                            skillId={skill.skillId}
                            skillName={skill.displayName || skill.skillId}
                            value={skill.level}
                            notInterested={skill.notInterested}
                            onChange={(level, notInterested) => handleSkillChange(skill.skillId, level, notInterested)}
                          />
                          <Button
                            variant="danger"
                            size="small"
                            leadingVisual={TrashIcon}
                            onClick={() => handleRemoveSkill(skill.skillId)}
                            aria-label={`Remove ${skill.displayName || skill.skillId}`}
                          />
                        </Stack>
                      </Stack>
                    </div>
                  ))}
                </Stack>
              )}
            </div>

            <div className={styles.lastUpdated}>
              {profile?.lastUpdated && (
                <p className={styles.lastUpdatedText}>
                  Last updated: {new Date(profile.lastUpdated).toLocaleDateString()}
                </p>
              )}
            </div>

            {/* Reset Data Section */}
            <div className={styles.dangerZone}>
              <Heading as="h3" className={styles.dangerTitle}>
                <AlertIcon size={16} /> Reset App Data
              </Heading>
              <p className={styles.dangerDescription}>
                Clear all locally stored data including skill profile, focus history, 
                chat threads, and challenge history. This will reset the app to its initial state.
              </p>
              {showResetConfirm ? (
                <Flash variant="danger">
                  <Stack direction="horizontal" align="center" justify="space-between">
                    <span>Are you sure? This cannot be undone.</span>
                    <Stack direction="horizontal" gap="condensed">
                      <Button variant="danger" onClick={handleClearAllData}>
                        Yes, Reset Everything
                      </Button>
                      <Button variant="invisible" onClick={() => setShowResetConfirm(false)}>
                        Cancel
                      </Button>
                    </Stack>
                  </Stack>
                </Flash>
              ) : (
                <Button variant="danger" onClick={() => setShowResetConfirm(true)}>
                  Clear All App Data
                </Button>
              )}
            </div>
          </Stack>
        </div>
      </main>
    </div>
  );
}
