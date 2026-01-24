

/**
 * Workspace Types
 *
 * Type definitions for multi-file workspace persistence in the Challenge Sandbox.
 * Supports file-based storage in .data/workspaces/{challengeId}/ directory.
 *
 * @remarks
 * This module uses server-side storage via API routes.
 * Import from hooks or components.
 *
 * @example
 * ```typescript
 * import type { ChallengeWorkspace, WorkspaceFile } from '@/lib/workspace';
 *
 * const file: WorkspaceFile = {
 *   id: 'file-1',
 *   name: 'solution.ts',
 *   content: 'function solve() {}',
 *   language: 'typescript',
 *   createdAt: now(),
 *   updatedAt: now(),
 * };
 * ```
 */

// =============================================================================
// File Types
// =============================================================================

/**
 * A single file within a workspace.
 */
export interface WorkspaceFile {
  /** Unique identifier for the file */
  id: string;
  /** File name including extension (e.g., "solution.ts") */
  name: string;
  /** File content */
  content: string;
  /** Programming language for syntax highlighting */
  language: string;
  /** ISO timestamp when the file was created */
  createdAt: string;
  /** ISO timestamp when the file was last modified */
  updatedAt: string;
}

/**
 * Metadata for a workspace file (stored in _workspace.json).
 * Content is stored separately in actual files.
 */
export interface WorkspaceFileMetadata {
  /** Unique identifier for the file */
  id: string;
  /** File name including extension (e.g., "solution.ts") */
  name: string;
  /** Programming language for syntax highlighting */
  language: string;
  /** ISO timestamp when the file was created */
  createdAt: string;
  /** ISO timestamp when the file was last modified */
  updatedAt: string;
}

// =============================================================================
// Workspace Types
// =============================================================================

/**
 * Metadata for a workspace (stored in _workspace.json sidecar).
 * File contents are stored as separate files in the workspace directory.
 */
export interface WorkspaceMetadata {
  /** Schema version for migration support */
  version: number;
  /** Challenge ID this workspace belongs to */
  challengeId: string;
  /** File metadata (content stored separately) */
  files: WorkspaceFileMetadata[];
  /** Currently active file ID */
  activeFileId: string;
  /** ISO timestamp when the workspace was created */
  createdAt: string;
  /** ISO timestamp when the workspace was last modified */
  updatedAt: string;
}

/**
 * A challenge workspace containing multiple files.
 *
 * Each workspace is scoped to a specific challenge and persisted
 * independently in server-side storage.
 */
export interface ChallengeWorkspace {
  /** Schema version for migration support */
  version: number;
  /** Challenge ID this workspace belongs to */
  challengeId: string;
  /** Files in the workspace */
  files: WorkspaceFile[];
  /** Currently active file ID */
  activeFileId: string;
  /** ISO timestamp when the workspace was created */
  createdAt: string;
  /** ISO timestamp when the workspace was last modified */
  updatedAt: string;
}

// =============================================================================
// Storage Types
// =============================================================================

/**
 * Interface for workspace storage operations.
 *
 * Implementations use server-side storage via API routes.
 */
export interface WorkspaceStoreInterface {
  /** Get workspace for a specific challenge */
  getWorkspace(challengeId: string): Promise<ChallengeWorkspace | null>;
  /** Save a workspace (creates or updates) */
  saveWorkspace(workspace: ChallengeWorkspace): Promise<void>;
  /** Delete workspace for a specific challenge */
  deleteWorkspace(challengeId: string): Promise<void>;
  /** List all stored challenge IDs with workspaces */
  listWorkspaces(): Promise<string[]>;
  /** Clear all workspace data */
  clearAll(): Promise<void>;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Current workspace schema version.
 */
export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1;

/**
 * Maximum workspace size in bytes before showing a warning.
 *
 * Server-side storage can handle larger files, but we warn at 5MB
 * to keep workspace sizes reasonable.
 */
export const MAX_WORKSPACE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Maximum number of files per workspace.
 *
 * Prevents Monaco editor performance issues with too many files.
 */
export const MAX_FILES_PER_WORKSPACE = 20;

/**
 * Auto-save debounce delay in milliseconds.
 */
export const AUTO_SAVE_DELAY_MS = 2000;
