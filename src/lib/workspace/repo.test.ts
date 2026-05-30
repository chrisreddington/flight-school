/**
 * Tests for the by-id challenge-workspace collection repository.
 *
 * Like {@link import('../challenge/repo').challengeSpecRepo} this is a
 * COLLECTION keyed by challenge id with deliberately SIDE-EFFECT-FREE reads: a
 * missing workspace returns `null` and never self-heals a default. The suite
 * pins that contract plus the whole-workspace-envelope read-through semantics
 * that fold the legacy multi-file tree (`_workspace.json` sidecar + one file per
 * `WorkspaceFile`) into a single envelope body:
 *
 * - Round-trip through the envelope store.
 * - Invalid id throws {@link InvalidWorkspaceIdError} on read/write/remove.
 * - Missing workspace → `null` (no default written).
 * - Corrupt envelope body → `null` (no write-back).
 * - Healthy legacy tree → reconstructed AS-IS (no promotion to an envelope),
 *   including a dot-named file (`solution.test.ts`) to PROVE the shared filename
 *   validator permits dots.
 * - Corrupt legacy sidecar → `null`.
 * - Unsafe legacy file name → empty content (validator rejects, never throws).
 * - Missing legacy content file → empty content.
 * - `list` is the SAFE_PATH_SEGMENT-filtered union of envelope ids and legacy
 *   directory names, deduplicated.
 * - `remove` / `removeAll` clear BOTH backends (legacy tree first).
 * - Cross-user isolation.
 *
 * Uses the REAL file adapter against a temp dir (env resolved at module load, so
 * modules are dynamic-imported after the env stub) with the tombstone seam
 * mocked.
 *
 * @module workspace/repo.test
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChallengeWorkspace, WorkspaceFile, WorkspaceMetadata } from './types';

const TEST_STORAGE_DIR = path.join(os.tmpdir(), `fs-workspace-repo-${Date.now()}`);

const isUserDeletedMock = vi.fn(async (): Promise<boolean> => false);

vi.mock('../storage/tombstone', () => ({
  isUserDeleted: (userId: string) => isUserDeletedMock(userId),
}));

// `repo` does not call `requireUserContext`, but its module graph pulls in
// next-auth at load through shared storage modules; a bare stub avoids that.
vi.mock('@/lib/auth/context', () => ({
  requireUserContext: vi.fn(),
}));

let workspacesRepo: typeof import('./repo').workspacesRepo;
let InvalidWorkspaceIdError: typeof import('./repo').InvalidWorkspaceIdError;
let getUserScopedStoreForUser: typeof import('../storage/document-store/scoped-store').getUserScopedStoreForUser;
let writeFile: typeof import('../storage/utils').writeFile;
let listDirs: typeof import('../storage/utils').listDirs;

const WORKSPACES_DIR = 'workspaces';
const METADATA_FILENAME = '_workspace.json';

function makeFile(overrides: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id: 'file-1',
    name: 'solution.ts',
    content: 'export const answer = 42;',
    language: 'typescript',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeWorkspace(challengeId: string, files: WorkspaceFile[] = [makeFile()]): ChallengeWorkspace {
  return {
    version: 1,
    challengeId,
    files,
    activeFileId: files[0]?.id ?? 'file-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
}

/**
 * Plant a legacy file tree: the `_workspace.json` sidecar plus one content file
 * per supplied name. A name present in `contentByName` but absent here simulates
 * a missing content file.
 */
async function plantLegacyTree(
  userId: string,
  challengeId: string,
  metadata: WorkspaceMetadata,
  contentByName: Record<string, string>,
): Promise<void> {
  const dir = `users/${userId}/${WORKSPACES_DIR}/${challengeId}`;
  await writeFile(dir, METADATA_FILENAME, JSON.stringify(metadata));
  for (const [name, content] of Object.entries(contentByName)) {
    await writeFile(dir, name, content);
  }
}

beforeAll(async () => {
  vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);
  await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
  ({ workspacesRepo, InvalidWorkspaceIdError } = await import('./repo'));
  ({ getUserScopedStoreForUser } = await import('../storage/document-store/scoped-store'));
  ({ writeFile, listDirs } = await import('../storage/utils'));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
});

beforeEach(() => {
  isUserDeletedMock.mockReset();
  isUserDeletedMock.mockResolvedValue(false);
});

describe('workspacesRepo round-trip', () => {
  it('persists and reads back a workspace by id', async () => {
    const workspace = makeWorkspace('round-trip');
    await workspacesRepo.write('ws-rt-user', workspace);
    expect(await workspacesRepo.read('ws-rt-user', 'round-trip')).toEqual(workspace);
  });
});

describe('workspacesRepo id validation', () => {
  it('throws InvalidWorkspaceIdError on read/write/remove for a traversal id', async () => {
    await expect(workspacesRepo.read('ws-bad-user', '../escape')).rejects.toBeInstanceOf(InvalidWorkspaceIdError);
    await expect(workspacesRepo.write('ws-bad-user', makeWorkspace('../escape'))).rejects.toBeInstanceOf(
      InvalidWorkspaceIdError,
    );
    await expect(workspacesRepo.remove('ws-bad-user', '../escape')).rejects.toBeInstanceOf(InvalidWorkspaceIdError);
  });
});

describe('workspacesRepo side-effect-free reads', () => {
  it('returns null for a never-written workspace and writes no default', async () => {
    expect(await workspacesRepo.read('ws-missing-user', 'never')).toBeNull();
    const store = await getUserScopedStoreForUser('ws-missing-user');
    expect(await store.getEnvelope('workspaces', 'never')).toBeNull();
  });

  it('returns null for a corrupt envelope body without writing it back', async () => {
    const store = await getUserScopedStoreForUser('ws-corrupt-user');
    await store.put('workspaces', 'corrupt', { version: 'nope' } as unknown as ChallengeWorkspace);
    expect(await workspacesRepo.read('ws-corrupt-user', 'corrupt')).toBeNull();
    const after = await store.getEnvelope<{ version: string }>('workspaces', 'corrupt');
    expect(after?.body).toEqual({ version: 'nope' });
  });
});

describe('workspacesRepo legacy read-through', () => {
  it('reconstructs a healthy legacy tree AS-IS, permits dot-named files, and does not promote to an envelope', async () => {
    const solution = makeFile({ id: 'file-1', name: 'solution.ts', content: 'export const a = 1;' });
    const test = makeFile({ id: 'file-2', name: 'solution.test.ts', content: 'expect(a).toBe(1);' });
    const metadata: WorkspaceMetadata = {
      version: 1,
      challengeId: 'legacy-ok',
      files: [
        {
          id: solution.id,
          name: solution.name,
          language: solution.language,
          createdAt: solution.createdAt,
          updatedAt: solution.updatedAt,
        },
        { id: test.id, name: test.name, language: test.language, createdAt: test.createdAt, updatedAt: test.updatedAt },
      ],
      activeFileId: 'file-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    await plantLegacyTree('ws-legacy-user', 'legacy-ok', metadata, {
      'solution.ts': solution.content,
      'solution.test.ts': test.content,
    });

    const result = await workspacesRepo.read('ws-legacy-user', 'legacy-ok');
    expect(result).toEqual(makeWorkspace('legacy-ok', [solution, test]));
    // The dot-named file was NOT skipped — proves the validator permits dots.
    expect(result?.files.find((file) => file.name === 'solution.test.ts')?.content).toBe('expect(a).toBe(1);');

    // No envelope was written (the migrator is the only legacy→envelope promoter).
    const store = await getUserScopedStoreForUser('ws-legacy-user');
    expect(await store.getEnvelope('workspaces', 'legacy-ok')).toBeNull();
  });

  it('returns null for a corrupt legacy sidecar', async () => {
    await writeFile('users/ws-legacy-bad-user/workspaces/broken', METADATA_FILENAME, '{"version":1}');
    expect(await workspacesRepo.read('ws-legacy-bad-user', 'broken')).toBeNull();
  });

  it('degrades an unsafe legacy file name to empty content instead of throwing', async () => {
    const metadata: WorkspaceMetadata = {
      version: 1,
      challengeId: 'unsafe-name',
      files: [{ id: 'file-1', name: 'bad name.ts', language: 'typescript', createdAt: 'x', updatedAt: 'y' }],
      activeFileId: 'file-1',
      createdAt: 'x',
      updatedAt: 'y',
    };
    // Plant only the sidecar; the unsafe name is rejected before any read anyway.
    await writeFile('users/ws-unsafe-user/workspaces/unsafe-name', METADATA_FILENAME, JSON.stringify(metadata));
    const result = await workspacesRepo.read('ws-unsafe-user', 'unsafe-name');
    expect(result?.files).toHaveLength(1);
    expect(result?.files[0]?.content).toBe('');
  });

  it('degrades a missing legacy content file to empty content', async () => {
    const metadata: WorkspaceMetadata = {
      version: 1,
      challengeId: 'missing-content',
      files: [{ id: 'file-1', name: 'gone.ts', language: 'typescript', createdAt: 'x', updatedAt: 'y' }],
      activeFileId: 'file-1',
      createdAt: 'x',
      updatedAt: 'y',
    };
    await writeFile(
      'users/ws-missing-content-user/workspaces/missing-content',
      METADATA_FILENAME,
      JSON.stringify(metadata),
    );
    const result = await workspacesRepo.read('ws-missing-content-user', 'missing-content');
    expect(result?.files[0]?.content).toBe('');
  });
});

describe('workspacesRepo list', () => {
  it('returns the deduplicated, segment-filtered union of envelope ids and legacy dirs', async () => {
    await workspacesRepo.write('ws-list-user', makeWorkspace('from-envelope'));
    // Legacy dir that also has an envelope (dedup) and a legacy-only dir.
    await workspacesRepo.write('ws-list-user', makeWorkspace('shared-id'));
    await writeFile('users/ws-list-user/workspaces/shared-id', METADATA_FILENAME, '{}');
    await writeFile('users/ws-list-user/workspaces/legacy-only', METADATA_FILENAME, '{}');
    // A junk directory whose name fails SAFE_PATH_SEGMENT must be filtered out.
    await writeFile('users/ws-list-user/workspaces/has.dot', METADATA_FILENAME, '{}');

    const ids = await workspacesRepo.list('ws-list-user');
    expect([...ids].sort()).toEqual(['from-envelope', 'legacy-only', 'shared-id']);
  });
});

describe('workspacesRepo remove', () => {
  it('clears BOTH the envelope and a residual legacy tree for one id', async () => {
    await workspacesRepo.write('ws-remove-user', makeWorkspace('gone'));
    await writeFile('users/ws-remove-user/workspaces/gone', METADATA_FILENAME, '{}');

    await workspacesRepo.remove('ws-remove-user', 'gone');

    expect(await workspacesRepo.read('ws-remove-user', 'gone')).toBeNull();
    expect(await listDirs('users/ws-remove-user/workspaces')).not.toContain('gone');
  });

  it('removeAll clears every workspace from both backends', async () => {
    await workspacesRepo.write('ws-removeall-user', makeWorkspace('a'));
    await writeFile('users/ws-removeall-user/workspaces/b', METADATA_FILENAME, '{}');

    await workspacesRepo.removeAll('ws-removeall-user');

    expect(await workspacesRepo.list('ws-removeall-user')).toEqual([]);
    expect(await listDirs('users/ws-removeall-user/workspaces')).toEqual([]);
  });
});

describe('workspacesRepo tenancy', () => {
  it("does not read another user's workspace for the same id", async () => {
    await workspacesRepo.write('ws-owner-user', makeWorkspace('shared'));
    expect(await workspacesRepo.read('ws-intruder-user', 'shared')).toBeNull();
  });
});
