/**
 * Workspace Export Helpers
 *
 * Shared helpers for exporting challenge workspaces to GitHub repositories.
 */

import {
  generateWorkspaceHintsFile,
  generateWorkspaceReadme,
  type WorkspaceExportChallengeMetadata,
  type WorkspaceExportFileInput,
} from './readme';

export interface WorkspaceExportFilesOptions {
  challenge: WorkspaceExportChallengeMetadata;
  files: WorkspaceExportFileInput[];
  evaluation?: string;
  hints?: string[];
}

export interface WorkspaceExportFile {
  path: string;
  content: string;
}

/**
 * Builds the list of files to commit for a workspace export.
 *
 * @param options - Export file options
 * @returns Files ready for commit
 */
export function buildWorkspaceExportFiles(
  options: WorkspaceExportFilesOptions
): WorkspaceExportFile[] {
  const filesToCommit: WorkspaceExportFile[] = options.files.map((file) => ({
    path: file.name,
    content: file.content,
  }));

  const readmeContent = generateWorkspaceReadme(
    options.challenge,
    options.files,
    options.evaluation
  );
  filesToCommit.push({
    path: 'README.md',
    content: readmeContent,
  });

  if (options.hints && options.hints.length > 0) {
    const hintsContent = generateWorkspaceHintsFile(options.hints);
    filesToCommit.push({
      path: 'HINTS.md',
      content: hintsContent,
    });
  }

  return filesToCommit;
}
