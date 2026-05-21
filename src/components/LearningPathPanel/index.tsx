'use client';

import { Button, Stack } from '@primer/react';
import { useEffect, useMemo, useState } from 'react';
import type { SkillNode } from '@/lib/skills/prerequisites';
import { getNextAchievableSkills, SKILL_PREREQUISITES } from '@/lib/skills/prerequisites';
import type { SkillProfile } from '@/lib/skills/types';
import styles from './LearningPathPanel.module.css';

interface LearningPathPanelProps {
  profile: SkillProfile;
  onAddSkill?: (skillId: string, displayName: string) => void;
}

export function LearningPathPanel({ profile, onAddSkill }: LearningPathPanelProps) {
  const [nextSkills, setNextSkills] = useState<SkillNode[]>([]);

  const skillNameMap = useMemo(
    () => new Map(SKILL_PREREQUISITES.map((skill) => [skill.skillId, skill.displayName])),
    []
  );

  useEffect(() => {
    setNextSkills(getNextAchievableSkills(profile).slice(0, 5));
  }, [profile]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <p className={styles.title}>🗺️ Learning Path</p>
      </div>
      <p className={styles.subtitle}>Skills to tackle next (based on your profile)</p>

      {profile.skills.length === 0 ? (
        <p className={styles.message}>Add skills to see learning paths</p>
      ) : nextSkills.length === 0 ? (
        <p className={styles.message}>Keep exploring to unlock more learning paths</p>
      ) : (
        <div className={styles.list}>
          {nextSkills.map((skill) => (
            <div key={skill.skillId} className={styles.item}>
              <Stack direction="vertical" gap="condensed">
                <p className={styles.skillName}>{skill.displayName}</p>
                <p className={styles.meta}>
                  Prereqs:{' '}
                  {skill.prerequisites.length === 0
                    ? 'None'
                    : skill.prerequisites
                      .map((prerequisite) => skillNameMap.get(prerequisite) ?? prerequisite)
                      .join(', ')}
                </p>
                {skill.unlocks && <p className={styles.meta}>Unlocks: {skill.unlocks}</p>}
                <div>
                  <Button
                    variant="invisible"
                    size="small"
                    onClick={() => onAddSkill?.(skill.skillId, skill.displayName)}
                  >
                    → Add to Goals
                  </Button>
                </div>
              </Stack>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
