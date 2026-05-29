/**
 * SkillsSidebar
 *
 * Left rail of the Skills page: stats grid, learning-path panel, and the
 * skill-level legend. (Destructive data reset lives in Settings.)
 */

'use client';

import { ProfileNav } from '@/components/ProfileNav';
import { LearningPathPanel } from '@/components/LearningPathPanel';
import type { SkillLevel, SkillProfile } from '@/lib/skills/types';
import { SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS } from '@/lib/skills/types';
import { CodeIcon, MortarBoardIcon } from '@primer/octicons-react';
import { Link, Stack } from '@primer/react';

import styles from '../profile-skills.module.css';
import layoutStyles from '@/styles/two-column-layout.module.css';

interface SkillsSidebarProps {
  profile: SkillProfile;
  onAddLearningPathSkill: (skillId: string, displayName: string) => void;
}

export function SkillsSidebar({ profile, onAddLearningPathSkill }: SkillsSidebarProps): React.JSX.Element {
  // f7 surfaced as: header shows "0 skills" while detected-GitHub skills are
  // listed below. Distinguish confirmed (manual + github-confirmed) from
  // detected-but-unconfirmed so the headline matches the list contents.
  const confirmedSkills = profile?.skills.filter((s) => s.source !== 'github').length || 0;
  const detectedSkills = profile?.skills.filter((s) => s.source === 'github').length || 0;
  const advancedSkills = profile?.skills.filter((s) => s.level === 'advanced').length || 0;
  const intermediateSkills = profile?.skills.filter((s) => s.level === 'intermediate').length || 0;
  const beginnerSkills = profile?.skills.filter((s) => s.level === 'beginner').length || 0;

  return (
    <aside className={layoutStyles.sidebar}>
      <ProfileNav />

      <div className={layoutStyles.sidebarCard}>
        <div className={layoutStyles.sidebarHeader}>
          <MortarBoardIcon size={20} className={layoutStyles.sidebarIcon} />
          <p className={layoutStyles.sidebarTitle}>Skill Profile</p>
        </div>
        <p className={layoutStyles.sidebarSubtitle}>Your learning journey</p>
        <p className={layoutStyles.sidebarSubtitle}>
          {confirmedSkills} confirmed · <Link href="#skill-suggestions-panel">{detectedSkills} detected</Link>
        </p>

        <div className={layoutStyles.statsGrid}>
          <div className={layoutStyles.statItem}>
            <span className={layoutStyles.statValue}>{confirmedSkills}</span>
            <span className={layoutStyles.statLabel}>Confirmed</span>
          </div>
          <div className={layoutStyles.statItem}>
            <span className={layoutStyles.statValue}>{detectedSkills}</span>
            <span className={layoutStyles.statLabel}>Detected</span>
          </div>
          <div className={layoutStyles.statItem}>
            <span className={layoutStyles.statValue}>{advancedSkills}</span>
            <span className={layoutStyles.statLabel}>Advanced</span>
          </div>
          <div className={layoutStyles.statItem}>
            <span className={layoutStyles.statValue}>{intermediateSkills}</span>
            <span className={layoutStyles.statLabel}>Intermediate</span>
          </div>
          <div className={layoutStyles.statItem}>
            <span className={layoutStyles.statValue}>{beginnerSkills}</span>
            <span className={layoutStyles.statLabel}>Beginner</span>
          </div>
        </div>
      </div>

      <LearningPathPanel profile={profile} onAddSkill={onAddLearningPathSkill} />

      <div className={layoutStyles.sidebarCard}>
        <div className={layoutStyles.sidebarHeader}>
          <CodeIcon size={20} className={layoutStyles.sidebarIcon} />
          <p className={layoutStyles.sidebarTitle}>Skill Levels</p>
        </div>
        <Stack direction="vertical" gap="condensed">
          {(['beginner', 'intermediate', 'advanced'] as SkillLevel[]).map((level) => (
            <div key={level} className={styles.legendItem}>
              <span className={styles.legendLevel}>{SKILL_LEVEL_LABELS[level]}</span>
              <span className={styles.legendDescription}>{SKILL_LEVEL_DESCRIPTIONS[level]}</span>
            </div>
          ))}
          <div className={styles.legendItem}>
            <span className={styles.legendLevel}>Not interested</span>
            <span className={styles.legendDescription}>Deprioritised in recommendations</span>
          </div>
        </Stack>
      </div>
    </aside>
  );
}
