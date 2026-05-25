import type { ChallengeDef } from '@/lib/copilot/types';
import { now } from '@/lib/utils/date-utils';
import { CURRENT_WORKSPACE_SCHEMA_VERSION, getWorkspaceTemplate } from '@/lib/workspace';
import type { ChallengeWorkspace } from './types';

/**
 * Builds a fresh workspace from the challenge template.
 *
 * Used on first load (no saved workspace), on load failure, and on reset.
 */
export function createWorkspaceFromTemplate(challengeId: string, challenge: ChallengeDef): ChallengeWorkspace {
  const templateFiles = getWorkspaceTemplate(challenge);
  const timestamp = now();
  return {
    version: CURRENT_WORKSPACE_SCHEMA_VERSION,
    challengeId,
    files: templateFiles,
    activeFileId: templateFiles[0]?.id ?? '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
