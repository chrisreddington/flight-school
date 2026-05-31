/**
 * Next-free reconstruction of the legacy challenge-workspace file tree.
 *
 * @remarks
 * The pre-envelope on-disk shape for a workspace is a multi-file tree under
 * `users/{userId}/workspaces/{challengeId}/`: a `_workspace.json` metadata
 * sidecar plus one file per {@link WorkspaceFile}. TWO callers must reassemble
 * that tree into a single {@link ChallengeWorkspace} body with byte-identical
 * semantics:
 *
 * - {@link import('./repo').workspacesRepo} — read-through migration when an
 *   envelope is absent but the legacy tree is present.
 * - {@link import('../storage/migrate').runStorageMigration} — the standalone
 *   importer that promotes legacy trees into envelopes.
 *
 * Keeping the reassembly in ONE place removes the drift risk of two
 * hand-maintained copies. This module is deliberately framework-free and
 * logger-free: the raw-read seam and the warning sink are BOTH injected, so it
 * carries no dependency on `@/lib/logger`, the API client, or any `next/*`
 * surface, and can be imported by the Next-free migration CLI.
 *
 * @module workspace/legacy-tree
 */

import { assertSafeWorkspaceFilename } from './filename';
import type { ChallengeWorkspace, WorkspaceFile, WorkspaceFileMetadata, WorkspaceMetadata } from './types';

/** The legacy directory (under a user's root) that holds workspace trees. */
export const WORKSPACES_DIR = 'workspaces';

/** The metadata sidecar file name inside each legacy workspace directory. */
export const METADATA_FILENAME = '_workspace.json';

/**
 * Reads a legacy file body, relative to the owning user's root
 * (`users/{userId}/`), returning `null` when the file is absent.
 */
export type LegacyReadRaw = (relativePath: string) => Promise<string | null>;

/**
 * Records a non-fatal degradation (corrupt sidecar, unsafe file name) without
 * coupling this leaf to a concrete logger.
 */
export type LegacyWarn = (message: string, context: Record<string, unknown>) => void;

/**
 * Strips the file content, leaving only the persisted metadata fields.
 */
export function toFileMetadata(file: WorkspaceFile): WorkspaceFileMetadata {
  return {
    id: file.id,
    name: file.name,
    language: file.language,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

/**
 * Rejoins file metadata with its on-disk content into a {@link WorkspaceFile}.
 */
export function toWorkspaceFile(meta: WorkspaceFileMetadata, content: string): WorkspaceFile {
  return {
    ...meta,
    content,
  };
}

/**
 * Shape check for a parsed legacy `_workspace.json` sidecar.
 *
 * @remarks
 * Legacy records are stored verbatim (including numeric `createdAt`/`updatedAt`
 * timestamps), so this guard asserts only the structural fields and never the
 * timestamp representation — tightening it would reject legacy-valid records.
 */
export function isWorkspaceMetadata(value: unknown): value is WorkspaceMetadata {
  if (typeof value !== 'object' || value === null) return false;
  const metadata = value as Record<string, unknown>;
  return (
    typeof metadata.version === 'number' &&
    typeof metadata.challengeId === 'string' &&
    Array.isArray(metadata.files) &&
    typeof metadata.activeFileId === 'string'
  );
}

/**
 * Parses a raw legacy file body, returning the parsed value or `undefined` when
 * the body is empty or not valid JSON.
 */
export function tryParse(raw: string): unknown {
  if (raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Reconstructs a {@link ChallengeWorkspace} from the legacy file tree, or `null`
 * when the metadata sidecar is absent or corrupt. Re-validates each on-disk file
 * name with {@link assertSafeWorkspaceFilename} before reading it — an unsafe
 * name (which `readRaw` would otherwise throw on) degrades to empty content and
 * a warning, never an error. Performs NO write-back.
 *
 * @param readRaw - Reads a file relative to `users/{userId}/`.
 * @param onWarn - Receives non-fatal degradations.
 * @param userId - Owning user; used only to build the containment directory the
 *   file-name safety check resolves against.
 * @param challengeId - The workspace's challenge id.
 */
export async function readLegacyWorkspaceTree(
  readRaw: LegacyReadRaw,
  onWarn: LegacyWarn,
  userId: string,
  challengeId: string,
): Promise<ChallengeWorkspace | null> {
  const workspaceDir = `users/${userId}/${WORKSPACES_DIR}/${challengeId}`;
  const metadataRaw = await readRaw(`${WORKSPACES_DIR}/${challengeId}/${METADATA_FILENAME}`);
  if (metadataRaw === null) return null;

  const parsed = tryParse(metadataRaw);
  if (!isWorkspaceMetadata(parsed)) {
    onWarn('Legacy workspace metadata missing or invalid; treating as missing', { challengeId });
    return null;
  }

  const files: WorkspaceFile[] = await Promise.all(
    parsed.files.map(async (fileMeta) => {
      try {
        assertSafeWorkspaceFilename(workspaceDir, fileMeta.name);
      } catch (validationError) {
        onWarn('Skipping legacy workspace file with unsafe name on read', {
          challengeId,
          name: fileMeta.name,
          error: validationError instanceof Error ? validationError.message : String(validationError),
        });
        return toWorkspaceFile(fileMeta, '');
      }
      const content = (await readRaw(`${WORKSPACES_DIR}/${challengeId}/${fileMeta.name}`)) ?? '';
      return toWorkspaceFile(fileMeta, content);
    }),
  );

  return {
    version: parsed.version,
    challengeId: parsed.challengeId,
    files,
    activeFileId: parsed.activeFileId,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}
