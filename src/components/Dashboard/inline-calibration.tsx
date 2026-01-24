/**
 * InlineCalibration Component
 *
 * Displays inline skill calibration suggestions within the Daily Focus section.
 * Allows users to quickly confirm or adjust skill levels detected by AI.
 *
 * @remarks
 * This component appears when the Focus API returns `calibrationNeeded` items,
 * indicating skills that may need user verification or adjustment.
 * Dismiss/confirm actions are persisted to focus storage.
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

import { focusStore } from '@/lib/focus/storage';
import type { CalibrationNeededItem } from '@/lib/focus/types';
import { skillsStore } from '@/lib/skills/storage';
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
  /** Callback when items are updated (for parent state sync) */
  onItemsChange?: (items: CalibrationNeededItem[]) => void;
  /** Whether to show the link to the full skills profile page (default: true) */
  showProfileLink?: boolean;
}

/**
 * Inline calibration widget for the Daily Focus section.
 *
 * Features:
 * - Shows skills detected from GitHub activity that need confirmation
 * - Quick accept/decline buttons for each skill
 * - Persists dismiss/confirm to focus storage
 * - Links to full skill profile page for detailed calibration
 */
export function InlineCalibration({ items, onItemsChange, showProfileLink = true }: InlineCalibrationProps) {
  // Track in-flight operations for optimistic UI
  const [processingSkills, setProcessingSkills] = useState<Set<string>>(new Set());

  // Handle accepting a suggested skill level
  const handleAccept = useCallback(async (item: CalibrationNeededItem) => {
    setProcessingSkills(prev => new Set(prev).add(item.skillId));

    const newSkill: UserSkill = {
      skillId: item.skillId,
      displayName: item.displayName,
      level: item.suggestedLevel as SkillLevel,
      source: 'github-confirmed', // User confirmed a skill detected from GitHub
      notInterested: false,
    };

    try {
      // Save to skills profile and remove from calibration list
      await Promise.all([
        skillsStore.setSkill(newSkill),
        focusStore.removeCalibrationItem(item.skillId),
      ]);
      
      // Notify parent of the change
      const updatedItems = items.filter(i => i.skillId !== item.skillId);
      onItemsChange?.(updatedItems);
    } catch {
      // Best effort - item may still be in storage
    } finally {
      setProcessingSkills(prev => {
        const next = new Set(prev);
        next.delete(item.skillId);
        return next;
      });
    }
  }, [items, onItemsChange]);

  // Handle dismissing a skill suggestion
  const handleDismiss = useCallback(async (skillId: string) => {
    setProcessingSkills(prev => new Set(prev).add(skillId));

    try {
      // Remove from storage
      await focusStore.removeCalibrationItem(skillId);
      
      // Notify parent of the change
      const updatedItems = items.filter(i => i.skillId !== skillId);
      onItemsChange?.(updatedItems);
    } catch {
      // Best effort
    } finally {
      setProcessingSkills(prev => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    }
  }, [items, onItemsChange]);

  // Filter out items being processed (optimistic removal)
  const visibleItems = items.filter(item => !processingSkills.has(item.skillId));

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
      
      {showProfileLink && (
        <Link href="/profile/skills" className={styles.calibrationLink}>
          Manage all skills in your profile →
        </Link>
      )}
    </div>
  );
}
