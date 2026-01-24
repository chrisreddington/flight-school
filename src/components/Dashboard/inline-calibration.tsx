/**
 * InlineCalibration Component
 *
 * Displays inline skill calibration suggestions within the Daily Focus section.
 * Allows users to quickly confirm or adjust skill levels detected by AI.
 *
 * @remarks
 * This component appears when the Focus API returns `calibrationNeeded` items,
 * indicating skills that may need user verification or adjustment.
 *
 * @example
 * ```tsx
 * <InlineCalibration
 *   items={[
 *     { skillId: 'typescript', displayName: 'TypeScript', suggestedLevel: 'intermediate' }
 *   ]}
 * />
 * ```
 */

'use client';

import type { CalibrationNeededItem } from '@/lib/focus/types';
import { now } from '@/lib/utils/date-utils';
import { getSkillProfile, saveSkillProfile } from '@/lib/skills/storage';
import type { SkillLevel, UserSkill } from '@/lib/skills/types';
import { SKILL_LEVEL_LABELS } from '@/lib/skills/types';
import { AlertIcon, CheckIcon, XIcon } from '@primer/octicons-react';
import { Button, Label, Link, Stack } from '@primer/react';
import { useCallback, useState } from 'react';
import styles from './Dashboard.module.css';

/** Props for the InlineCalibration component */
export interface InlineCalibrationProps {
  /** Skills that need calibration */
  items: CalibrationNeededItem[];
}

/**
 * Inline calibration widget for the Daily Focus section.
 *
 * Features:
 * - Shows skills detected from GitHub activity that need confirmation
 * - Quick accept/decline buttons for each skill
 * - Links to full skill profile page for detailed calibration
 */
export function InlineCalibration({ items }: InlineCalibrationProps) {
  const [dismissedSkills, setDismissedSkills] = useState<Set<string>>(new Set());
  const [confirmedSkills, setConfirmedSkills] = useState<Set<string>>(new Set());

  // Handle accepting a suggested skill level
  const handleAccept = useCallback((item: CalibrationNeededItem) => {
    const profile = getSkillProfile();
    
    // Check if skill already exists
    const existingIndex = profile.skills.findIndex(s => s.skillId === item.skillId);
    
    const newSkill: UserSkill = {
      skillId: item.skillId,
      displayName: item.displayName,
      level: item.suggestedLevel as SkillLevel,
      source: 'manual', // User confirmed, so it's manual
      notInterested: false,
    };

    if (existingIndex >= 0) {
      profile.skills[existingIndex] = newSkill;
    } else {
      profile.skills.push(newSkill);
    }

    profile.lastUpdated = now();
    saveSkillProfile(profile);
    
    setConfirmedSkills(prev => new Set(prev).add(item.skillId));
  }, []);

  // Handle dismissing a skill suggestion
  const handleDismiss = useCallback((skillId: string) => {
    setDismissedSkills(prev => new Set(prev).add(skillId));
  }, []);

  // Filter out dismissed and confirmed skills
  const visibleItems = items.filter(
    item => !dismissedSkills.has(item.skillId) && !confirmedSkills.has(item.skillId)
  );

  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div className={styles.calibrationSection} role="region" aria-label="Skill calibration suggestions">
      <Stack direction="horizontal" align="center" gap="condensed" className={styles.calibrationHeader}>
        <AlertIcon size={16} />
        <span className={styles.calibrationTitle}>
          We detected some skills - confirm your levels for better recommendations
        </span>
      </Stack>
      
      <Stack direction="vertical" gap="condensed" className={styles.calibrationItems}>
        {visibleItems.map(item => (
          <div key={item.skillId} className={styles.calibrationItem}>
            <Stack direction="horizontal" align="center" justify="space-between">
              <Stack direction="horizontal" align="center" gap="condensed">
                <span className={styles.skillName}>{item.displayName}</span>
                <Label variant="secondary" size="small">
                  {SKILL_LEVEL_LABELS[item.suggestedLevel as SkillLevel] || item.suggestedLevel}
                </Label>
              </Stack>
              <Stack direction="horizontal" gap="condensed">
                <Button
                  size="small"
                  variant="primary"
                  leadingVisual={CheckIcon}
                  onClick={() => handleAccept(item)}
                  aria-label={`Confirm ${item.displayName} as ${item.suggestedLevel}`}
                >
                  Confirm
                </Button>
                <Button
                  size="small"
                  variant="invisible"
                  leadingVisual={XIcon}
                  onClick={() => handleDismiss(item.skillId)}
                  aria-label={`Dismiss ${item.displayName} suggestion`}
                >
                  Dismiss
                </Button>
              </Stack>
            </Stack>
          </div>
        ))}
      </Stack>
      
      <Link href="/profile/skills" className={styles.calibrationLink}>
        Manage all skills in your profile →
      </Link>
    </div>
  );
}
