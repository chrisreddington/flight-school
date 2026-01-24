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
import { SkillSlider } from '@/components/SkillSlider';
import { useBreadcrumb } from '@/contexts/breadcrumb-context';
import { focusStore } from '@/lib/focus/storage';
import { logger } from '@/lib/logger';
import { getSkillProfile, saveSkillProfile } from '@/lib/skills/storage';
import type { SkillLevel, SkillProfile, UserSkill } from '@/lib/skills/types';
import { SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS } from '@/lib/skills/types';
import { now } from '@/lib/utils/date-utils';
import { AlertIcon, InfoIcon, PlusIcon, TrashIcon } from '@primer/octicons-react';
import {
    Button,
    Flash,
    FormControl,
    Heading,
    Link,
    Stack,
    TextInput,
} from '@primer/react';
import { useCallback, useState } from 'react';
import styles from './profile-skills.module.css';

/** localStorage keys used by the app (client-side only) */
const APP_STORAGE_KEYS = [
  'flight-school-skill-profile',
  'dgc-threads',
  'dgc-workspace',
  'dgc-challenge-history',
];

/**
 * Skill Profile Page Component
 */
export default function SkillProfilePage() {
  const [profile, setProfile] = useState<SkillProfile>(() => getSkillProfile());
  const [newSkillName, setNewSkillName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Register this page in breadcrumb history
  useBreadcrumb('/profile/skills', 'Skill Profile', '/profile/skills');

  // Handle skill level and interest change
  const handleSkillChange = useCallback((skillId: string, level: SkillLevel, notInterested: boolean) => {
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
    
    saveSkillProfile(updatedProfile);
    setProfile(updatedProfile);
  }, [profile]);

  // Handle removing a skill
  const handleRemoveSkill = useCallback((skillId: string) => {
    if (!profile) return;
    
    const updatedSkills = profile.skills.filter(skill => skill.skillId !== skillId);
    
    const updatedProfile: SkillProfile = {
      skills: updatedSkills,
      lastUpdated: now(),
    };
    
    saveSkillProfile(updatedProfile);
    setProfile(updatedProfile);
  }, [profile]);

  // Handle adding a new skill
  const handleAddSkill = useCallback(() => {
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
    
    saveSkillProfile(updatedProfile);
    setProfile(updatedProfile);
    setNewSkillName('');
    setShowAddForm(false);
  }, [profile, newSkillName]);

  // Handle clearing all app data
  const handleClearAllData = useCallback(async () => {
    // Clear localStorage keys
    APP_STORAGE_KEYS.forEach(key => {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore errors
      }
    });

    // Clear focus storage (API-based)
    try {
      await focusStore.clear();
    } catch (error) {
      logger.error('Failed to clear focus storage', { error }, 'SkillsPage');
      // Continue anyway - best effort
    }

    // Reload page to reset app state
    window.location.href = '/';
  }, []);

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
                  levels here to fine-tune your recommendations.
                </p>
              </Stack>
            </div>

            <div className={styles.levelLegend}>
              <Heading as="h3" className={styles.legendTitle}>Skill Levels</Heading>
              <Stack direction="vertical" gap="condensed">
                {(['beginner', 'intermediate', 'advanced'] as SkillLevel[]).map(level => (
                  <div key={level} className={styles.legendItem}>
                    <span className={styles.legendLevel}>{SKILL_LEVEL_LABELS[level]}</span>
                    <span className={styles.legendDescription}>{SKILL_LEVEL_DESCRIPTIONS[level]}</span>
                  </div>
                ))}
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
                            {skill.source === 'github' ? 'Detected from GitHub' : 'Manually added'}
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
