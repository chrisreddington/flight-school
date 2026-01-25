/**
 * README Module
 *
 * Barrel exports for README-related functionality:
 * - Summary extraction from existing READMEs
 * - Learning README generation
 * - Workspace export README generation
 */

// Summary (fetching and extracting info from existing READMEs)
export { getRepoReadmeSummary } from './summary';

// Learning README generation
export { generateLearningReadme } from './learning-readme';

// Workspace export README generation
export {
    generateWorkspaceHintsFile,
    generateWorkspaceReadme,
    type WorkspaceExportChallengeMetadata,
    type WorkspaceExportFileInput,
} from './workspace-readme';
