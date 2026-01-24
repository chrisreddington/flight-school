/**
 * GitHub API Request Types and Validation
 *
 * Centralized request shapes and validation helpers for GitHub-related API routes.
 */

import { validateObject, validateRequiredString } from '@/lib/api';
import { validateRepoName } from '@/lib/github/validation';
import type { WorkspaceExportChallengeMetadata, WorkspaceExportFileInput } from './readme';

// =============================================================================
// Repository Creation
// =============================================================================

/** Request body for creating a repository */
export interface CreateRepoRequest {
  /** Repository name (required, must be valid GitHub repo name) */
  name: string;
  /** Repository description */
  description?: string;
  /** Whether the repository should be private */
  isPrivate?: boolean;
  /** Learning topic for AI-generated README */
  topic?: string;
}

/**
 * Validates the request body for repository creation.
 *
 * @param body - The parsed request body
 * @returns Error message if invalid, null if valid
 */
export function validateCreateRepoRequest(body: unknown): string | null {
  const bodyError = validateObject(body, 'Request body');
  if (bodyError) {
    return bodyError;
  }

  const req = body as Record<string, unknown>;
  return validateRepoName(req.name as string);
}

// =============================================================================
// Issues
// =============================================================================

/** Request body for creating a generic issue */
export interface CreateIssueRequest {
  type: 'generic';
  owner: string;
  repo: string;
  title: string;
  body?: string;
  labels?: string[];
}

/** Request body for creating a learning goal issue */
export interface CreateLearningGoalRequest {
  type: 'learning-goal';
  owner: string;
  repo: string;
  topic: string;
  description?: string;
}

export type IssueRequest = CreateIssueRequest | CreateLearningGoalRequest;

/**
 * Validates the request body for issue creation.
 *
 * @param body - The parsed request body
 * @returns Error message if invalid, null if valid
 */
export function validateIssueRequest(body: unknown): string | null {
  const bodyError = validateObject(body, 'Request body');
  if (bodyError) {
    return bodyError;
  }

  const req = body as Record<string, unknown>;

  if (!req.type || (req.type !== 'generic' && req.type !== 'learning-goal')) {
    return 'Invalid type. Must be "generic" or "learning-goal"';
  }

  const ownerError = validateRequiredString(req.owner, 'owner');
  if (ownerError) return ownerError;

  const repoError = validateRequiredString(req.repo, 'repo');
  if (repoError) return repoError;

  if (req.type === 'generic') {
    return validateRequiredString(req.title, 'title');
  }

  return validateRequiredString(req.topic, 'topic');
}

// =============================================================================
// Workspace Export
// =============================================================================

/** Request body for exporting workspace */
export interface ExportWorkspaceRequest {
  /** Unique challenge ID */
  challengeId: string;
  /** Repository name */
  repoName: string;
  /** Repository description */
  description?: string;
  /** Whether the repository should be private */
  isPrivate?: boolean;
  /** Files to export */
  files: WorkspaceExportFileInput[];
  /** Challenge metadata */
  challenge: WorkspaceExportChallengeMetadata;
  /** Optional evaluation summary */
  evaluation?: string;
  /** Optional hints used */
  hints?: string[];
}

/**
 * Validates the export request body.
 *
 * @param body - The parsed request body
 * @returns Error message if invalid, null if valid
 */
export function validateExportWorkspaceRequest(body: unknown): string | null {
  const bodyError = validateObject(body, 'Request body');
  if (bodyError) {
    return bodyError;
  }

  const req = body as Record<string, unknown>;

  const challengeIdError = validateRequiredString(req.challengeId, 'challengeId');
  if (challengeIdError) {
    return challengeIdError;
  }

  const nameError = validateRepoName(req.repoName as string);
  if (nameError) {
    return nameError;
  }

  if (!Array.isArray(req.files) || req.files.length === 0) {
    return 'At least one file is required';
  }

  for (const file of req.files) {
    if (!file || typeof file !== 'object') {
      return 'Invalid file format';
    }
    const fileRecord = file as Record<string, unknown>;
    const nameError = validateRequiredString(fileRecord.name, 'name');
    if (nameError) {
      return 'Each file must have a name';
    }
    if (typeof fileRecord.content !== 'string') {
      return 'Each file must have content';
    }
  }

  if (!req.challenge || typeof req.challenge !== 'object') {
    return 'Challenge metadata is required';
  }

  const challenge = req.challenge as Record<string, unknown>;
  const titleError = validateRequiredString(challenge.title, 'Challenge title');
  if (titleError) {
    return titleError;
  }

  return null;
}
