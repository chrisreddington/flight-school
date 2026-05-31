/**
 * Tests for the Next-free legacy-workspace reassembly leaf.
 *
 * @remarks
 * These assert the leaf in isolation against an in-memory raw-read seam — the
 * same contract both {@link import('./repo').workspacesRepo} and the storage
 * importer rely on. The parallel repo-level coverage in `repo.test.ts` proves
 * the delegation wiring; this file pins the leaf's own behaviour so the
 * importer can depend on it directly.
 */

import { describe, expect, it, vi } from 'vitest';
import { readLegacyWorkspaceTree, toFileMetadata, toWorkspaceFile } from './legacy-tree';
import type { WorkspaceFileMetadata, WorkspaceMetadata } from './types';

const USER_ID = 'octocat';
const CHALLENGE_ID = 'fizzbuzz';

/** Builds an in-memory `readRaw` over a fixed `users/{userId}/`-relative map. */
function makeReadRaw(files: Record<string, string>) {
  return vi.fn(async (relativePath: string): Promise<string | null> => {
    return Object.prototype.hasOwnProperty.call(files, relativePath) ? files[relativePath] : null;
  });
}

function metadataSidecar(overrides: Partial<WorkspaceMetadata> = {}): WorkspaceMetadata {
  const solution: WorkspaceFileMetadata = {
    id: 'file-1',
    name: 'solution.ts',
    language: 'typescript',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
  return {
    version: 1,
    challengeId: CHALLENGE_ID,
    files: [solution],
    activeFileId: 'file-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('readLegacyWorkspaceTree', () => {
  it('returns null without warning when the metadata sidecar is absent', async () => {
    const onWarn = vi.fn();
    const result = await readLegacyWorkspaceTree(makeReadRaw({}), onWarn, USER_ID, CHALLENGE_ID);

    expect(result).toBeNull();
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('reassembles metadata and per-file content into one workspace body', async () => {
    const onWarn = vi.fn();
    const readRaw = makeReadRaw({
      'workspaces/fizzbuzz/_workspace.json': JSON.stringify(metadataSidecar()),
      'workspaces/fizzbuzz/solution.ts': 'export const answer = 42;',
    });

    const result = await readLegacyWorkspaceTree(readRaw, onWarn, USER_ID, CHALLENGE_ID);

    expect(result).toEqual({
      version: 1,
      challengeId: CHALLENGE_ID,
      files: [
        {
          id: 'file-1',
          name: 'solution.ts',
          language: 'typescript',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          content: 'export const answer = 42;',
        },
      ],
      activeFileId: 'file-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('treats a missing file body as empty content', async () => {
    const onWarn = vi.fn();
    const readRaw = makeReadRaw({
      'workspaces/fizzbuzz/_workspace.json': JSON.stringify(metadataSidecar()),
    });

    const result = await readLegacyWorkspaceTree(readRaw, onWarn, USER_ID, CHALLENGE_ID);

    expect(result?.files[0].content).toBe('');
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('warns and returns null for a corrupt sidecar', async () => {
    const onWarn = vi.fn();
    const readRaw = makeReadRaw({
      'workspaces/fizzbuzz/_workspace.json': '{ not valid json',
    });

    const result = await readLegacyWorkspaceTree(readRaw, onWarn, USER_ID, CHALLENGE_ID);

    expect(result).toBeNull();
    expect(onWarn).toHaveBeenCalledWith('Legacy workspace metadata missing or invalid; treating as missing', {
      challengeId: CHALLENGE_ID,
    });
  });

  it('warns and returns null when the sidecar fails the shape check', async () => {
    const onWarn = vi.fn();
    const readRaw = makeReadRaw({
      'workspaces/fizzbuzz/_workspace.json': JSON.stringify({ version: 1 }),
    });

    const result = await readLegacyWorkspaceTree(readRaw, onWarn, USER_ID, CHALLENGE_ID);

    expect(result).toBeNull();
    expect(onWarn).toHaveBeenCalledWith('Legacy workspace metadata missing or invalid; treating as missing', {
      challengeId: CHALLENGE_ID,
    });
  });

  it('degrades an unsafe file name to empty content instead of throwing', async () => {
    const onWarn = vi.fn();
    const unsafe = metadataSidecar({
      files: [
        {
          id: 'file-1',
          name: 'bad name.ts',
          language: 'typescript',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    const readRaw = makeReadRaw({
      'workspaces/fizzbuzz/_workspace.json': JSON.stringify(unsafe),
    });

    const result = await readLegacyWorkspaceTree(readRaw, onWarn, USER_ID, CHALLENGE_ID);

    expect(result?.files).toHaveLength(1);
    expect(result?.files[0]).toMatchObject({ name: 'bad name.ts', content: '' });
    expect(onWarn).toHaveBeenCalledWith(
      'Skipping legacy workspace file with unsafe name on read',
      expect.objectContaining({ challengeId: CHALLENGE_ID, name: 'bad name.ts' }),
    );
    // The unsafe-name content read must be skipped entirely.
    expect(readRaw).not.toHaveBeenCalledWith('workspaces/fizzbuzz/bad name.ts');
  });
});

describe('toFileMetadata / toWorkspaceFile round-trip', () => {
  it('strips and rejoins content without mutating the other fields', () => {
    const original = {
      id: 'file-9',
      name: 'main.py',
      language: 'python',
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
      content: 'print("hi")',
    };

    const meta = toFileMetadata(original);
    expect(meta).not.toHaveProperty('content');

    const rejoined = toWorkspaceFile(meta, original.content);
    expect(rejoined).toEqual(original);
  });
});
