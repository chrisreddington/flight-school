/**
 * DifficultyBadge Component
 *
 * Displays a skill difficulty level (Beginner/Intermediate/Advanced) as a styled badge.
 * SINGLE SOURCE OF TRUTH for all difficulty badge styling in the app.
 *
 * @example
 * ```tsx
 * <DifficultyBadge difficulty="beginner" />
 * <DifficultyBadge difficulty="intermediate" size="small" />
 * <DifficultyBadge difficulty="advanced" showIcon />
 * ```
 */

import type { SkillLevel } from '@/lib/skills/types';
import { SKILL_LEVEL_LABELS } from '@/lib/skills/types';
import { FlameIcon } from '@primer/octicons-react';
import { Label } from '@primer/react';
import styles from './DifficultyBadge.module.css';

/** Badge size variants */
type DifficultyBadgeSize = 'small' | 'large';

/** Props for the DifficultyBadge component */
export interface DifficultyBadgeProps {
  /** The difficulty level to display */
  difficulty: SkillLevel;
  /** Badge size (defaults to 'small') */
  size?: DifficultyBadgeSize;
  /** Whether to show the flame icon (defaults to false) */
  showIcon?: boolean;
  /** Optional CSS class name */
  className?: string;
  /**
   * Use CSS-based styling instead of Primer Label.
   * Useful for contexts requiring custom styling (e.g., sandbox header).
   */
  variant?: 'label' | 'css';
}

/**
 * Renders a styled difficulty badge using Primer's Label component.
 *
 * @remarks
 * This is the SINGLE SOURCE OF TRUTH for difficulty badge rendering.
 * All instances of Beginner/Intermediate/Advanced badges should use this component.
 */
export function DifficultyBadge({
  difficulty,
  size = 'small',
  showIcon = false,
  className,
  variant = 'label',
}: DifficultyBadgeProps) {
  const label = SKILL_LEVEL_LABELS[difficulty];
  const labelVariant = (difficulty === 'beginner' ? 'success' 
    : difficulty === 'intermediate' ? 'attention' 
    : 'danger') as 'success' | 'attention' | 'danger';

  // CSS-based variant for custom styling contexts
  if (variant === 'css') {
    return (
      <span
        className={`${styles.badge} ${className || ''}`}
        data-difficulty={difficulty}
      >
        {showIcon && <FlameIcon size={12} />} {label}
      </span>
    );
  }

  // Default: Primer Label variant
  return (
    <Label variant={labelVariant} size={size} className={className}>
      {showIcon && <FlameIcon size={12} />} {label}
    </Label>
  );
}
