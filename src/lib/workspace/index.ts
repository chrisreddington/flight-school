/**
 * Workspace Module
 *
 * Multi-file workspace support for the Challenge Sandbox.
 * Provides file-based persistence, templates, and file management.
 *
 * @remarks
 * This module is client-side only. Import only from hooks or components.
 *
 * @example
 * ```typescript
 * import {
 *   workspaceStore,
 *   getWorkspaceTemplate,
 *   createEmptyFile,
 *   type ChallengeWorkspace,
 * } from '@/lib/workspace';
 * ```
 */

// Types
export type { 
    ChallengeWorkspace, 
    WorkspaceFile,
} from './types';

// Constants
export {
    AUTO_SAVE_DELAY_MS,
    CURRENT_WORKSPACE_SCHEMA_VERSION,
    MAX_FILES_PER_WORKSPACE
} from './types';

// Storage
export { workspaceStore } from './storage';

// Templates
export { createEmptyFile, getWorkspaceTemplate } from './templates';

