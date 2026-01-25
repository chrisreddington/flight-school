'use client';

/**
 * ChallengeActionMenu Component
 *
 * Reusable kebab menu for challenge actions (Edit, Skip, Refresh, Create, etc.).
 * Used in Daily Focus section and Focus History for consistent UX.
 *
 * @example
 * ```tsx
 * <ChallengeActionMenu
 *   challenge={challenge}
 *   isCustom={true}
 *   onEdit={() => router.push(`/challenge/edit/${challenge.id}`)}
 *   onSkip={handleSkip}
 *   onCreate={handleCreate}
 * />
 * ```
 */

import type { DailyChallenge } from '@/lib/focus/types';
import {
  CheckIcon,
  KebabHorizontalIcon,
  PencilIcon,
  SkipIcon,
  XIcon,
} from '@primer/octicons-react';
import { ActionList, ActionMenu, IconButton } from '@primer/react';
import { memo } from 'react';

/**
 * Props for the {@link ChallengeActionMenu} component.
 */
interface ChallengeActionMenuProps {
  /** The challenge this menu is for */
  challenge: DailyChallenge;
  /** Whether this is a custom challenge */
  isCustom?: boolean;
  /** Size variant for the menu button */
  size?: 'small' | 'medium';
  /** Callback to edit the challenge (custom only) */
  onEdit?: () => void;
  /** Callback to skip the challenge */
  onSkip?: () => void;
  /** Callback to refresh the challenge (AI-generated only) */
  onRefresh?: () => void;
  /** Whether refresh is disabled */
  refreshDisabled?: boolean;
  /** Callback to create a new custom challenge */
  onCreate?: () => void;
  /** Callback to mark challenge as complete */
  onMarkComplete?: () => void;
  /** Callback to create a repo for the challenge */
  onCreateRepo?: () => void;
  /** Show history-specific actions (Mark Complete, Create Repo) */
  showHistoryActions?: boolean;
}

/**
 * Kebab menu for challenge actions.
 *
 * Provides a consistent action menu across Daily Focus and Focus History.
 */
export const ChallengeActionMenu = memo(function ChallengeActionMenu({
  challenge: _challenge,
  isCustom = false,
  size = 'medium',
  onEdit,
  onSkip,
  onRefresh,
  refreshDisabled = false,
  onCreate,
  onMarkComplete,
  onCreateRepo,
  showHistoryActions = false,
}: ChallengeActionMenuProps) {
  // _challenge kept for future use (e.g., analytics, logging)
  void _challenge;
  
  // Don't render if no actions are available
  const hasActions =
    onEdit || onSkip || onRefresh || onCreate || onMarkComplete || onCreateRepo;
  if (!hasActions) return null;

  return (
    <ActionMenu>
      <ActionMenu.Anchor>
        <IconButton
          icon={KebabHorizontalIcon}
          variant="invisible"
          size={size}
          aria-label="Challenge options"
        />
      </ActionMenu.Anchor>
      <ActionMenu.Overlay>
        <ActionList>
          {/* Custom challenge actions */}
          {isCustom && onEdit && (
            <ActionList.Item onSelect={onEdit}>
              <ActionList.LeadingVisual>
                <PencilIcon />
              </ActionList.LeadingVisual>
              Edit Challenge
            </ActionList.Item>
          )}
          {isCustom && onSkip && (
            <ActionList.Item onSelect={onSkip}>
              <ActionList.LeadingVisual>
                <SkipIcon />
              </ActionList.LeadingVisual>
              Skip Challenge
            </ActionList.Item>
          )}
          {isCustom && (onEdit || onSkip) && (onRefresh || onCreate || showHistoryActions) && (
            <ActionList.Divider />
          )}

          {/* AI challenge skip (use onSkip for skip-and-replace behavior) */}
          {!isCustom && onSkip && (
            <ActionList.Item onSelect={onSkip} disabled={refreshDisabled}>
              <ActionList.LeadingVisual>
                <SkipIcon />
              </ActionList.LeadingVisual>
              Skip Challenge
            </ActionList.Item>
          )}

          {/* History-specific actions */}
          {showHistoryActions && onMarkComplete && (
            <ActionList.Item onSelect={onMarkComplete}>
              <ActionList.LeadingVisual>
                <CheckIcon />
              </ActionList.LeadingVisual>
              Mark Complete
            </ActionList.Item>
          )}
          {showHistoryActions && onSkip && !isCustom && (
            <ActionList.Item onSelect={onSkip}>
              <ActionList.LeadingVisual>
                <XIcon />
              </ActionList.LeadingVisual>
              Skip
            </ActionList.Item>
          )}
          {showHistoryActions && (onMarkComplete || onCreateRepo || onSkip) && onCreate && (
            <ActionList.Divider />
          )}

          {/* Create custom challenge */}
          {onCreate && (
            <ActionList.Item onSelect={onCreate}>
              <ActionList.LeadingVisual>
                <PencilIcon />
              </ActionList.LeadingVisual>
              Create Custom Challenge
            </ActionList.Item>
          )}
        </ActionList>
      </ActionMenu.Overlay>
    </ActionMenu>
  );
});
