/**
 * SkillsList
 *
 * Renders the user's calibrated skills (card per skill) with a slider + remove
 * button. Falls back to an empty-state link when the profile has no skills.
 */

'use client';

import { SkillSlider } from '@/components/SkillSlider';
import type { SkillLevel, SkillProfile, SkillSource } from '@/lib/skills/types';
import { SKILL_SOURCE_LABELS } from '@/lib/skills/types';
import { MortarBoardIcon, TrashIcon } from '@primer/octicons-react';
import { Button, Stack } from '@primer/react';
import { Blankslate } from '@primer/react/experimental';

import styles from '../profile-skills.module.css';

interface SkillsListProps {
  profile: SkillProfile;
  onSkillChange: (skillId: string, level: SkillLevel, notInterested: boolean) => void;
  onRemoveSkill: (skillId: string) => void;
}

export function SkillsList({ profile, onSkillChange, onRemoveSkill }: SkillsListProps): React.JSX.Element {
  if (profile?.skills.length === 0) {
    return (
      <Blankslate>
        <Blankslate.Visual>
          <MortarBoardIcon size={24} />
        </Blankslate.Visual>
        <Blankslate.Heading>No skills configured yet</Blankslate.Heading>
        <Blankslate.Description>
          Skills will be detected automatically from your GitHub activity, or you can add them manually.
        </Blankslate.Description>
        <Blankslate.PrimaryAction href="/">Return to Dashboard</Blankslate.PrimaryAction>
      </Blankslate>
    );
  }

  return (
    <Stack direction="vertical" gap="normal" className={styles.skillsList}>
      {profile?.skills.map((skill) => (
        <div key={skill.skillId} className={styles.skillCard}>
          <Stack
            direction={{ narrow: 'vertical', regular: 'horizontal' }}
            align="start"
            justify="space-between"
            gap="normal"
          >
            <div className={styles.skillInfo}>
              <span className={styles.skillName}>{skill.displayName || skill.skillId}</span>
              <span className={styles.skillSource}>
                {SKILL_SOURCE_LABELS[skill.source as SkillSource] || skill.source}
              </span>
            </div>
            <Stack direction="horizontal" align="start" gap="condensed" className={styles.skillControls}>
              <SkillSlider
                skillId={skill.skillId}
                skillName={skill.displayName || skill.skillId}
                value={skill.level}
                notInterested={skill.notInterested}
                onChange={(level, notInterested) => onSkillChange(skill.skillId, level, notInterested)}
              />
              <Button
                variant="danger"
                size="small"
                leadingVisual={TrashIcon}
                onClick={() => onRemoveSkill(skill.skillId)}
                aria-label={`Remove ${skill.displayName || skill.skillId}`}
              />
            </Stack>
          </Stack>
        </div>
      ))}
    </Stack>
  );
}
