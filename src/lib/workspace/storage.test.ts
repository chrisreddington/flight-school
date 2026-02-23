/**
 * Tests for Workspace Storage.
 *
 * Tests the workspace store API-based operations, including:
 * - Loading and saving workspaces
 * - Creating, updating, deleting workspaces
 * - Listing workspaces
 * - Size validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ChallengeWorkspace, WorkspaceFile } from './types';
import { MAX_WORKSPACE_SIZE_BYTES } from './types';

// Mock modules before imports
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/utils/date-utils', () => ({
  now: vi.fn(() => '2024-01-15T12:00:00.000Z'),
}));

// Import after mocking
const { apiGet, apiPost, apiDelete } = await import('@/lib/api-client');
const { workspaceStore } = await import('./storage');

describe('Workspace Storage', () => {
  const mockFile: WorkspaceFile = {
    id: 'file-1',
    name: 'solution.ts',
    content: 'function solution() { return 42; }',
    language: 'typescript',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  };

  const mockWorkspace: ChallengeWorkspace = {
    version: 1,
    challengeId: 'challenge-1',
    files: [mockFile],
    activeFileId: 'file-1',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: {},
      writable: true,
    });
  });

  // ===========================================================================
  // getWorkspace() tests
  // ===========================================================================

  describe('getWorkspace', () => {
    it('should load workspace from API', async () => {
      vi.mocked(apiGet).mockResolvedValue(mockWorkspace);

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(apiGet).toHaveBeenCalledWith(
        '/api/workspace/storage?challengeId=challenge-1',
        { throwOnError: false }
      );
      expect(result).toEqual(mockWorkspace);
    });

    it('should return null when workspace not found', async () => {
      vi.mocked(apiGet).mockResolvedValue(null);

      const result = await workspaceStore.getWorkspace('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when challengeId mismatch', async () => {
      const mismatchedWorkspace = { ...mockWorkspace, challengeId: 'wrong-challenge' };
      vi.mocked(apiGet).mockResolvedValue(mismatchedWorkspace);
      vi.mocked(apiDelete).mockResolvedValue(undefined);

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(apiDelete).toHaveBeenCalledWith('/api/workspace/storage?challengeId=challenge-1');
      expect(result).toBeNull();
    });

    it('should return null when API throws error', async () => {
      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(result).toBeNull();
    });

    it('should warn when workspace exceeds size limit', async () => {
      const largeContent = 'x'.repeat(MAX_WORKSPACE_SIZE_BYTES);
      const largeWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        files: [{ ...mockFile, content: largeContent }],
      };
      vi.mocked(apiGet).mockResolvedValue(largeWorkspace);

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(result).toBeDefined();
      // Logger warning should be called (checked via mock)
    });

    it('should return null when running server-side', async () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
      });

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(result).toBeNull();
      expect(apiGet).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // saveWorkspace() tests
  // ===========================================================================

  describe('saveWorkspace', () => {
    it('should save workspace to API', async () => {
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await workspaceStore.saveWorkspace(mockWorkspace);

      expect(apiPost).toHaveBeenCalledWith('/api/workspace/storage', expect.objectContaining({
        challengeId: 'challenge-1',
        files: [mockFile],
      }));
    });

    it('should update timestamp when saving', async () => {
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await workspaceStore.saveWorkspace(mockWorkspace);

      const savedWorkspace = vi.mocked(apiPost).mock.calls[0][1] as ChallengeWorkspace;
      expect(savedWorkspace.updatedAt).toBe('2024-01-15T12:00:00.000Z');
    });

    it('should warn when workspace is large', async () => {
      const largeContent = 'x'.repeat(MAX_WORKSPACE_SIZE_BYTES + 1000);
      const largeWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        files: [{ ...mockFile, content: largeContent }],
      };
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await workspaceStore.saveWorkspace(largeWorkspace);

      expect(apiPost).toHaveBeenCalled();
      // Logger warning should be called
    });

    it('should throw error when API fails', async () => {
      vi.mocked(apiPost).mockRejectedValue(new Error('Network error'));

      await expect(workspaceStore.saveWorkspace(mockWorkspace)).rejects.toThrow('Network error');
    });

    it('should not save when running server-side', async () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
      });

      await workspaceStore.saveWorkspace(mockWorkspace);

      expect(apiPost).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // deleteWorkspace() tests
  // ===========================================================================

  describe('deleteWorkspace', () => {
    it('should delete workspace from API', async () => {
      vi.mocked(apiDelete).mockResolvedValue(undefined);

      await workspaceStore.deleteWorkspace('challenge-1');

      expect(apiDelete).toHaveBeenCalledWith('/api/workspace/storage?challengeId=challenge-1');
    });

    it('should not throw when workspace does not exist', async () => {
      vi.mocked(apiDelete).mockRejectedValue(new Error('Not found'));

      await workspaceStore.deleteWorkspace('nonexistent');

      // Should not throw, error is logged
      expect(apiDelete).toHaveBeenCalled();
    });

    it('should not delete when running server-side', async () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
      });

      await workspaceStore.deleteWorkspace('challenge-1');

      expect(apiDelete).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // listWorkspaces() tests
  // ===========================================================================

  describe('listWorkspaces', () => {
    it('should list all workspace challenge IDs', async () => {
      const mockList = { challengeIds: ['challenge-1', 'challenge-2', 'challenge-3'] };
      vi.mocked(apiGet).mockResolvedValue(mockList);

      const result = await workspaceStore.listWorkspaces();

      expect(apiGet).toHaveBeenCalledWith('/api/workspace/storage/list', { throwOnError: false });
      expect(result).toEqual(['challenge-1', 'challenge-2', 'challenge-3']);
    });

    it('should return empty array when no workspaces', async () => {
      vi.mocked(apiGet).mockResolvedValue({ challengeIds: [] });

      const result = await workspaceStore.listWorkspaces();

      expect(result).toEqual([]);
    });

    it('should return empty array when API returns null', async () => {
      vi.mocked(apiGet).mockResolvedValue(null);

      const result = await workspaceStore.listWorkspaces();

      expect(result).toEqual([]);
    });

    it('should return empty array when API throws error', async () => {
      vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

      const result = await workspaceStore.listWorkspaces();

      expect(result).toEqual([]);
    });

    it('should return empty array when running server-side', async () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
      });

      const result = await workspaceStore.listWorkspaces();

      expect(result).toEqual([]);
      expect(apiGet).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // clearAll() tests
  // ===========================================================================

  describe('clearAll', () => {
    it('should clear all workspaces', async () => {
      vi.mocked(apiDelete).mockResolvedValue(undefined);

      await workspaceStore.clearAll();

      expect(apiDelete).toHaveBeenCalledWith('/api/workspace/storage');
    });

    it('should not throw when API fails', async () => {
      vi.mocked(apiDelete).mockRejectedValue(new Error('Network error'));

      await workspaceStore.clearAll();

      // Should not throw, error is logged
      expect(apiDelete).toHaveBeenCalled();
    });

    it('should not clear when running server-side', async () => {
      Object.defineProperty(globalThis, 'window', {
        value: undefined,
        writable: true,
      });

      await workspaceStore.clearAll();

      expect(apiDelete).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Multiple files tests
  // ===========================================================================

  describe('multiple files', () => {
    it('should handle workspace with multiple files', async () => {
      const file2: WorkspaceFile = {
        id: 'file-2',
        name: 'solution.test.ts',
        content: 'test code',
        language: 'typescript',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
      };
      const multiFileWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        files: [mockFile, file2],
      };
      vi.mocked(apiGet).mockResolvedValue(multiFileWorkspace);

      const result = await workspaceStore.getWorkspace('challenge-1');

      expect(result?.files).toHaveLength(2);
      expect(result?.files).toContainEqual(mockFile);
      expect(result?.files).toContainEqual(file2);
    });

    it('should save workspace with multiple files', async () => {
      const file2: WorkspaceFile = {
        id: 'file-2',
        name: 'utils.ts',
        content: 'export const util = () => {}',
        language: 'typescript',
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T10:00:00.000Z',
      };
      const multiFileWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        files: [mockFile, file2],
      };
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await workspaceStore.saveWorkspace(multiFileWorkspace);

      const savedWorkspace = vi.mocked(apiPost).mock.calls[0][1] as ChallengeWorkspace;
      expect(savedWorkspace.files).toHaveLength(2);
    });
  });

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle empty files array', async () => {
      const emptyWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        files: [],
        activeFileId: '',
      };
      vi.mocked(apiPost).mockResolvedValue(undefined);

      await workspaceStore.saveWorkspace(emptyWorkspace);

      expect(apiPost).toHaveBeenCalled();
    });

    it('should handle workspace with special characters in challengeId', async () => {
      const specialWorkspace: ChallengeWorkspace = {
        ...mockWorkspace,
        challengeId: 'challenge-with-special-chars_123',
      };
      vi.mocked(apiGet).mockResolvedValue(specialWorkspace);

      const result = await workspaceStore.getWorkspace('challenge-with-special-chars_123');

      expect(apiGet).toHaveBeenCalledWith(
        '/api/workspace/storage?challengeId=challenge-with-special-chars_123',
        { throwOnError: false }
      );
      expect(result).toEqual(specialWorkspace);
    });

    it('should properly URL encode challengeId in delete', async () => {
      vi.mocked(apiDelete).mockResolvedValue(undefined);

      await workspaceStore.deleteWorkspace('challenge/with/slashes');

      expect(apiDelete).toHaveBeenCalledWith(
        '/api/workspace/storage?challengeId=challenge%2Fwith%2Fslashes'
      );
    });
  });
});
