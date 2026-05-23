import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FocusStorageSchema } from './types';
import {
  clearFocusStorage,
  readFocusStorage,
  writeFocusStorage,
} from './persistence';

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    withTag: () => ({
      debug: vi.fn(),
      error: mocks.logError,
      warn: mocks.logWarn,
    }),
  },
}));

const { apiDelete, apiGet, apiPost } = await import('@/lib/api-client');

describe('focus persistence adapter', () => {
  const schema: FocusStorageSchema = { history: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  it('should read focus storage from the API route', async () => {
    vi.mocked(apiGet).mockResolvedValue(schema);

    await expect(readFocusStorage()).resolves.toBe(schema);

    expect(apiGet).toHaveBeenCalledWith('/api/focus/storage');
  });

  it('should return empty storage when reading fails', async () => {
    vi.mocked(apiGet).mockRejectedValue(new Error('Network error'));

    await expect(readFocusStorage()).resolves.toEqual({ history: {} });
  });

  it('should not log aborted reads as errors', async () => {
    const abortError = new Error('Fetch is aborted');
    abortError.name = 'AbortError';
    vi.mocked(apiGet).mockRejectedValue(abortError);

    await expect(readFocusStorage()).resolves.toEqual({ history: {} });

    expect(mocks.logError).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      'Storage read skipped (network unavailable)',
      'Fetch is aborted',
    );
  });

  it('should skip transient network write failures and rethrow other write failures', async () => {
    const abortError = new Error('Load failed');
    abortError.name = 'AbortError';
    vi.mocked(apiPost).mockRejectedValueOnce(abortError);

    await expect(writeFocusStorage(schema)).resolves.toBeUndefined();

    vi.mocked(apiPost).mockRejectedValueOnce(new Error('Unauthorized'));

    await expect(writeFocusStorage(schema)).rejects.toThrow('Unauthorized');
  });

  it('should clear focus storage through the API route', async () => {
    vi.mocked(apiDelete).mockResolvedValue(undefined);

    await clearFocusStorage();

    expect(apiDelete).toHaveBeenCalledWith('/api/focus/storage');
  });
});
