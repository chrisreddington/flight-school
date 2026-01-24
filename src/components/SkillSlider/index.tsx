/**
 * SkillSlider Component
 *
 * Accessible 3-level slider for skill calibration with "Not interested" option.
 * Supports Beginner/Intermediate/Advanced levels with keyboard navigation.
 *
 * @remarks
 * - Uses native slider with `aria-valuetext` for screen reader level names
 * - Keyboard: Arrow keys increment/decrement, Home/End for min/max
 * - Respects `prefers-reduced-motion` for animations
 *
 * @example
 * ```tsx
 * <SkillSlider
 *   skillId="typescript"
 *   skillName="TypeScript"
 *   value="intermediate"
 *   onChange={(level, notInterested) => console.log(level, notInterested)}
 * />
 * ```
 */
'use client';

import type { SkillLevel } from '@/lib/skills/types';
import { SKILL_LEVEL_DESCRIPTIONS, SKILL_LEVEL_LABELS } from '@/lib/skills/types';
import { Checkbox, FormControl } from '@primer/react';
import { useCallback, useId, useMemo, useState } from 'react';
import styles from './SkillSlider.module.css';

// =============================================================================
// Types
// =============================================================================

/**
 * Props for the SkillSlider component.
 */
export interface SkillSliderProps {
  /** Unique identifier for the skill */
  skillId: string;
  /** Human-readable skill name */
  skillName: string;
  /** Current skill level */
  value: SkillLevel;
  /** Whether user is not interested in this skill */
  notInterested?: boolean;
  /** Callback when level or interest changes */
  onChange: (level: SkillLevel, notInterested: boolean) => void;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
}

// =============================================================================
// Constants
// =============================================================================

const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];

// =============================================================================
// Component
// =============================================================================

/**
 * Accessible skill level slider with "Not interested" option.
 *
 * @remarks
 * Implements WCAG-compliant keyboard navigation and screen reader support.
 * Uses aria-valuetext to announce human-readable level names.
 */
export function SkillSlider({
  skillName,
  value,
  notInterested: initialNotInterested = false,
  onChange,
  disabled = false,
  className,
}: SkillSliderProps) {
  const uniqueId = useId();
  const sliderId = `skill-slider-${uniqueId}`;
  const labelId = `skill-label-${uniqueId}`;
  const checkboxId = `skill-checkbox-${uniqueId}`;
  
  const [notInterested, setNotInterested] = useState(initialNotInterested);

  // Level index for slider value
  const levelIndex = useMemo(() => LEVELS.indexOf(value), [value]);

  /**
   * Handle slider change.
   * Maps numeric value back to SkillLevel.
   */
  const handleSliderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const newIndex = parseInt(event.target.value, 10);
      const newLevel = LEVELS[newIndex];
      onChange(newLevel, notInterested);
    },
    [onChange, notInterested]
  );

  /**
   * Handle "Not interested" checkbox change.
   */
  const handleNotInterestedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const checked = event.target.checked;
      setNotInterested(checked);
      onChange(value, checked);
    },
    [onChange, value]
  );

  /**
   * Handle keyboard navigation for slider.
   * Home = min (beginner), End = max (advanced).
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Home') {
        event.preventDefault();
        onChange('beginner', notInterested);
      } else if (event.key === 'End') {
        event.preventDefault();
        onChange('advanced', notInterested);
      }
    },
    [onChange, notInterested]
  );

  // Calculate filled percentage for gradient
  const filledPercent = (levelIndex / 2) * 100;

  return (
    <div className={`${styles.container} ${notInterested ? styles.notInterested : ''} ${className || ''}`}>
      <label id={labelId} htmlFor={sliderId} className="sr-only">
        {skillName} skill level
      </label>
      
      <div className={styles.sliderWrapper}>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={2}
          step={1}
          value={levelIndex}
          onChange={handleSliderChange}
          onKeyDown={handleKeyDown}
          aria-labelledby={labelId}
          aria-valuetext={`${SKILL_LEVEL_LABELS[value]}: ${SKILL_LEVEL_DESCRIPTIONS[value]}`}
          disabled={disabled || notInterested}
          className={styles.slider}
          style={{
            background: notInterested 
              ? 'var(--bgColor-muted, #f6f8fa)'
              : `linear-gradient(to right, var(--bgColor-accent-emphasis, #0969da) 0%, var(--bgColor-accent-emphasis, #0969da) ${filledPercent}%, var(--borderColor-default, #d0d7de) ${filledPercent}%, var(--borderColor-default, #d0d7de) 100%)`,
          }}
        />
        
        <div className={styles.levelLabels}>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => !notInterested && onChange(level, notInterested)}
              disabled={notInterested}
              className={`${styles.levelLabel} ${level === value && !notInterested ? styles.levelLabelActive : ''}`}
              aria-label={`Set ${skillName} to ${SKILL_LEVEL_LABELS[level]}`}
            >
              {SKILL_LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.notInterestedRow}>
        <FormControl>
          <Checkbox
            id={checkboxId}
            checked={notInterested}
            onChange={handleNotInterestedChange}
            disabled={disabled}
          />
          <FormControl.Label htmlFor={checkboxId}>
            Not interested
          </FormControl.Label>
        </FormControl>
      </div>
    </div>
  );
}
