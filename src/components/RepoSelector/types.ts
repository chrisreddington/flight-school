/**
 * RepoSelector Types
 *
 * Type definitions for the repository selector component.
 */

import type { RepoReference } from '@/lib/threads/types';

/**
 * Repository option for the selector dropdown.
 */
export interface RepoOption {
  /** Full name (owner/name) */
  fullName: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  name: string;
  /** Primary language */
  language?: string;
}

/**
 * Props for the {@link RepoSelector} component.
 */
export interface RepoSelectorProps {
  /** Currently selected repositories */
  selectedRepos: RepoReference[];
  /** Callback when selection changes */
  onSelectionChange: (repos: RepoReference[]) => void;
  /** Available repositories to select from */
  availableRepos?: RepoOption[];
  /** Whether repos are loading */
  isLoading?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Maximum repos that can be selected */
  maxSelections?: number;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Inline mode - collapsible panel for single-row layout */
  inline?: boolean;
}
