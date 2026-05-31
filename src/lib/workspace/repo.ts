/**
 * Per-user, by-id challenge-workspace collection accessor over the envelope
 * {@link import('../storage/document-store/types').DocumentStore}.
 *
 * A user owns MANY workspaces, one per challenge id, so — like
 * {@link import('../challenge/repo').challengeSpecRepo} — this is a COLLECTION
 * repo rather than a domain singleton: every method takes an already-trusted
 * `userId`, and reads are deliberately SIDE-EFFECT-FREE (a missing workspace is
 * a genuine `null`, never a freshly-minted default).
 *
 * **Storage model — whole-workspace envelope.** The legacy on-disk shape is a
 * multi-file tree (`workspaces/{id}/_workspace.json` metadata sidecar plus one
 * file per `WorkspaceFile`). This repo collapses that into ONE envelope body per
 * workspace, keyed by `challengeId` in the `'workspaces'` container; the former
 * per-file names become inert JSON fields. Workspaces are bounded
 * ({@link import('./types').MAX_FILES_PER_WORKSPACE} files,
 * {@link import('./types').MAX_WORKSPACE_SIZE_BYTES} soft cap), so a single body
 * stays well within backend document limits.
 *
 * Read-through-migrating semantics mirror the singleton compat core MINUS the
 * self-heal write-back:
 * - Envelope present + valid → return the body.
 * - Envelope present + corrupt → `null` (+warn), no write-back.
 * - Envelope absent + legacy tree present → reconstruct the body from the
 *   sidecar + content files and return it AS-IS (the standalone migrator is the
 *   only legacy→envelope promoter).
 * - Envelope absent + legacy missing/corrupt → `null` (+warn on corrupt).
 *
 * **Trust boundary.** `write` stores the body verbatim with no shape/size/count
 * guard, preserving the legacy route contract exactly. Callers that accept
 * externally-supplied file names (the POST route) MUST validate them with
 * {@link assertSafeWorkspaceFilename} BEFORE calling `write`; the repo trusts the
 * body it is handed.
 *
 * This module is SERVER-SIDE: {@link buildCompatDeps} imports the `server-only`
 * envelope backend and the file-tree seam lives in `@/lib/storage/utils`.
 *
 * @module workspace/repo
 */

import { logger } from '@/lib/logger';
import { buildCompatDeps } from '@/lib/storage/document-store/compat-deps';
import { SAFE_PATH_SEGMENT } from '@/lib/storage/user-scope';
import { deleteDir, listDirs } from '@/lib/storage/utils';
import { WORKSPACES_DIR, readLegacyWorkspaceTree } from './legacy-tree';
import type { ChallengeWorkspace } from './types';

const log = logger.withTag('Workspace Repo');

/** The envelope container challenge workspaces live in. */
const WORKSPACES_CONTAINER = 'workspaces' as const;

/**
 * Thrown when a supplied challenge `id` fails {@link SAFE_PATH_SEGMENT}
 * validation.
 *
 * @remarks
 * The `/api/workspace/storage` route pre-validates the id inline and returns a
 * `400` before reaching the repo, so this throw is the defence-in-depth net
 * rather than the primary 400-class path.
 */
export class InvalidWorkspaceIdError extends Error {
  constructor(id: string) {
    super(`Invalid workspace id: ${JSON.stringify(id)}`);
    this.name = 'InvalidWorkspaceIdError';
  }
}

/** Reject an `id` that could escape the per-user `workspaces/` partition. */
function assertSafeWorkspaceId(id: string): void {
  if (!SAFE_PATH_SEGMENT.test(id)) {
    throw new InvalidWorkspaceIdError(id);
  }
}

/**
 * Defensive shape check applied to every envelope read. Mirrors only the
 * load-bearing fields the sandbox consumes. The legacy route wrote workspaces
 * verbatim (including numeric `createdAt`/`updatedAt`), so this guard must not
 * assert timestamp representation — doing so would reject legacy-valid records.
 * Full validation is the writer's responsibility.
 */
function isChallengeWorkspace(value: unknown): value is ChallengeWorkspace {
  if (typeof value !== 'object' || value === null) return false;
  const workspace = value as Record<string, unknown>;
  return (
    typeof workspace.version === 'number' &&
    typeof workspace.challengeId === 'string' &&
    Array.isArray(workspace.files) &&
    typeof workspace.activeFileId === 'string'
  );
}

/**
 * Reconstruct a {@link ChallengeWorkspace} from the legacy file tree, or `null`
 * when the metadata sidecar is absent or corrupt. Delegates the byte-identical
 * reassembly to the shared, Next-free {@link readLegacyWorkspaceTree} leaf,
 * wiring it to this repo's legacy raw-read seam and logger.
 */
async function readLegacyWorkspace(
  deps: Awaited<ReturnType<typeof buildCompatDeps>>,
  userId: string,
  challengeId: string,
): Promise<ChallengeWorkspace | null> {
  return readLegacyWorkspaceTree(
    (relativePath) => deps.legacy.readRaw(relativePath),
    (message, context) => log.warn(message, context),
    userId,
    challengeId,
  );
}

/**
 * Typed, explicit-`userId` accessor for a user's by-id challenge workspaces. The
 * `userId` is already trusted (resolved from a server auth context by the
 * caller); the repo never re-authenticates.
 */
export interface WorkspacesRepo {
  /**
   * Read the workspace stored under `challengeId`, or `null` when absent/corrupt.
   * Reads NEVER write (no self-heal) — a missing workspace is genuine absence.
   *
   * @throws {InvalidWorkspaceIdError} when `challengeId` fails {@link SAFE_PATH_SEGMENT}.
   */
  read(userId: string, challengeId: string): Promise<ChallengeWorkspace | null>;
  /**
   * Persist `workspace` under its `challengeId`. Stores the body verbatim — no
   * write-side shape/size/count guard. Callers accepting external file names
   * MUST validate them first (see module trust-boundary note).
   *
   * @throws {InvalidWorkspaceIdError} when the workspace's `challengeId` fails
   *   {@link SAFE_PATH_SEGMENT}.
   */
  write(userId: string, workspace: ChallengeWorkspace): Promise<void>;
  /**
   * Remove the workspace stored under `challengeId` from BOTH the envelope store
   * and any residual legacy tree. The legacy tree is deleted FIRST so a failure
   * leaves the envelope intact (a later read returns the envelope, not a stale
   * legacy resurrection).
   *
   * @throws {InvalidWorkspaceIdError} when `challengeId` fails {@link SAFE_PATH_SEGMENT}.
   */
  remove(userId: string, challengeId: string): Promise<void>;
  /**
   * Remove ALL workspaces for the user from BOTH backends. Legacy tree first,
   * then the envelope partition, for the same anti-resurrection reason as
   * {@link WorkspacesRepo.remove}.
   */
  removeAll(userId: string): Promise<void>;
  /**
   * List every challenge id with a stored workspace — the UNION of envelope ids
   * and residual legacy directory names, deduplicated. Both sides are filtered
   * to {@link SAFE_PATH_SEGMENT} so junk directories never leak out.
   */
  list(userId: string): Promise<string[]>;
}

/**
 * The singleton {@link WorkspacesRepo} instance. Reuses {@link buildCompatDeps}
 * for the envelope store + legacy read seam, and imports the file-tree
 * delete/list primitives directly from `@/lib/storage/utils`.
 */
export const workspacesRepo: WorkspacesRepo = {
  async read(userId: string, challengeId: string): Promise<ChallengeWorkspace | null> {
    assertSafeWorkspaceId(challengeId);
    const deps = await buildCompatDeps(userId);

    const envelope = await deps.store.getEnvelope<ChallengeWorkspace>(WORKSPACES_CONTAINER, challengeId);
    if (envelope !== null) {
      if (isChallengeWorkspace(envelope.body)) {
        return envelope.body;
      }
      log.warn('Workspace envelope failed shape check; treating as missing', { challengeId });
      return null;
    }

    return readLegacyWorkspace(deps, userId, challengeId);
  },

  async write(userId: string, workspace: ChallengeWorkspace): Promise<void> {
    assertSafeWorkspaceId(workspace.challengeId);
    const deps = await buildCompatDeps(userId);
    await deps.store.put(WORKSPACES_CONTAINER, workspace.challengeId, workspace);
  },

  async remove(userId: string, challengeId: string): Promise<void> {
    assertSafeWorkspaceId(challengeId);
    const deps = await buildCompatDeps(userId);
    // Legacy tree first: a failed legacy delete leaves the envelope intact, so a
    // later read returns the envelope rather than resurrecting the legacy tree.
    await deleteDir(`users/${userId}/${WORKSPACES_DIR}/${challengeId}`);
    await deps.store.remove(WORKSPACES_CONTAINER, challengeId);
  },

  async removeAll(userId: string): Promise<void> {
    const deps = await buildCompatDeps(userId);
    await deleteDir(`users/${userId}/${WORKSPACES_DIR}`);
    await deps.store.deletePartition(WORKSPACES_CONTAINER);
  },

  async list(userId: string): Promise<string[]> {
    const deps = await buildCompatDeps(userId);

    const ids = new Set<string>();

    let cursor: string | undefined;
    do {
      const page = await deps.store.list<ChallengeWorkspace>(WORKSPACES_CONTAINER, { cursor });
      for (const envelope of page.items) {
        if (SAFE_PATH_SEGMENT.test(envelope.id)) ids.add(envelope.id);
      }
      cursor = page.nextCursor;
    } while (cursor);

    const legacyDirs = await listDirs(`users/${userId}/${WORKSPACES_DIR}`);
    for (const dirName of legacyDirs) {
      if (SAFE_PATH_SEGMENT.test(dirName)) ids.add(dirName);
    }

    return [...ids];
  },
};
