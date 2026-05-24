/**
 * ChallengeHeader subcomponent
 *
 * Renders the sandbox header: challenge title, optional debug badge,
 * collapsible description, difficulty badge, the Free/Guided mode toggle,
 * and the optional "Solve Challenge" debug action.
 *
 * Extracted from `ChallengeSandbox` to keep the parent focused on
 * orchestration. State for description collapse and mode selection still
 * lives in the parent so behavior is unchanged.
 */

import { DifficultyBadge } from '@/components/DifficultyBadge';
import { MarkdownContent } from '@/components/MarkdownContent';
import type { ChallengeDef } from '@/lib/copilot/types';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CodeIcon,
  InfoIcon,
  RocketIcon,
} from '@primer/octicons-react';
import { Button, Label, SegmentedControl } from '@primer/react';
import styles from './ChallengeSandbox.module.css';

export interface ChallengeHeaderProps {
  challenge: ChallengeDef;
  mode: 'free' | 'guided';
  onSelectMode: (mode: 'free' | 'guided') => void;
  isDescriptionCollapsed: boolean;
  onToggleDescription: () => void;
  isDebugMode: boolean;
  onSolveChallenge: () => void;
  isSolving: boolean;
  isEvaluating: boolean;
}

export function ChallengeHeader({
  challenge,
  mode,
  onSelectMode,
  isDescriptionCollapsed,
  onToggleDescription,
  isDebugMode,
  onSolveChallenge,
  isSolving,
  isEvaluating,
}: ChallengeHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <span className={styles.headerIcon}>
          <CodeIcon size={20} />
        </span>
        <div className={styles.headerTitleGroup}>
          <div className={styles.headerTitleRow}>
            <h2 className={styles.headerTitle}>{challenge.title}</h2>
            {challenge.type === 'debug' && (
              <Label size="small" variant="attention">
                🐛 Debug Mode
              </Label>
            )}
            {challenge.description && (
              <button
                className={styles.descriptionToggle}
                onClick={onToggleDescription}
                aria-expanded={!isDescriptionCollapsed}
                aria-label={isDescriptionCollapsed ? 'Expand description' : 'Collapse description'}
                type="button"
              >
                {isDescriptionCollapsed ? <ChevronRightIcon size={16} /> : <ChevronDownIcon size={16} />}
                <span className={styles.sectionIcon}>
                  <InfoIcon size={16} />
                </span>
                <span className={styles.sectionTitle}>Description</span>
              </button>
            )}
          </div>
          {challenge.description && !isDescriptionCollapsed && (
            <div className={styles.headerDescription}>
              <MarkdownContent content={challenge.description} />
            </div>
          )}
        </div>
        <DifficultyBadge difficulty={challenge.difficulty} variant="css" />
      </div>
      <div className={styles.headerRight}>
        <SegmentedControl aria-label="Challenge mode">
          <SegmentedControl.Button selected={mode === 'free'} onClick={() => onSelectMode('free')}>
            Free Mode
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={mode === 'guided'} onClick={() => onSelectMode('guided')}>
            Guided Mode
          </SegmentedControl.Button>
        </SegmentedControl>
        {isDebugMode && (
          <Button
            variant="invisible"
            size="small"
            onClick={onSolveChallenge}
            leadingVisual={RocketIcon}
            disabled={isSolving || isEvaluating}
          >
            {isSolving ? 'Solving...' : 'Solve Challenge'}
          </Button>
        )}
      </div>
    </div>
  );
}
