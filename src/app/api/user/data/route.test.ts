import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserContextMock,
  readCredentialsFromJwtMock,
  clearActivityMock,
  getAllJobsMock,
  deleteForUserMock,
  deleteDirMock,
  markUserDeletedMock,
  cancelRunningJobMock,
  UnauthorizedErrorMock,
} = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {}
  return {
    requireUserContextMock: vi.fn(),
    readCredentialsFromJwtMock: vi.fn(),
    clearActivityMock: vi.fn(),
    getAllJobsMock: vi.fn(),
    deleteForUserMock: vi.fn(),
    deleteDirMock: vi.fn(),
    markUserDeletedMock: vi.fn(),
    cancelRunningJobMock: vi.fn(),
    UnauthorizedErrorMock,
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  readCredentialsFromJwt: readCredentialsFromJwtMock,
  UnauthorizedError: UnauthorizedErrorMock,
}));

vi.mock('@/lib/copilot/activity/logger', () => ({
  activityLogger: {
    clear: clearActivityMock,
  },
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    getAll: getAllJobsMock,
    deleteForUser: deleteForUserMock,
  },
}));

vi.mock('@/lib/storage/utils', () => ({
  deleteDir: deleteDirMock,
}));

vi.mock('@/lib/storage/tombstone', () => ({
  markUserDeleted: markUserDeletedMock,
}));

vi.mock('../../jobs/route', () => ({
  cancelRunningJob: cancelRunningJobMock,
}));

import { DELETE } from './route';

function makeRequest({
  origin = 'https://app.local',
  host = 'app.local',
  body,
}: {
  origin?: string;
  host?: string;
  body?: unknown;
} = {}): Request {
  return new Request('https://app.local/api/user/data', {
    method: 'DELETE',
    headers: {
      origin,
      host,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const nowSec = Math.floor(Date.now() / 1000);
  requireUserContextMock.mockResolvedValue({ userId: 'user-1', login: 'alice' });
  readCredentialsFromJwtMock.mockResolvedValue({ lastSignInAt: nowSec });
  getAllJobsMock.mockResolvedValue([]);
  deleteForUserMock.mockResolvedValue({ deleted: 2 });
  cancelRunningJobMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/user/data', () => {
  it('returns 401 when auth context is missing', async () => {
    requireUserContextMock.mockRejectedValue(new UnauthorizedErrorMock('Unauthorized'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when recent-auth window is stale', async () => {
    const staleSec = Math.floor(Date.now() / 1000) - 10 * 60;
    readCredentialsFromJwtMock.mockResolvedValue({ lastSignInAt: staleSec });

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.code).toBe('recent_auth_required');
    expect(body.windowSeconds).toBe(300);
    expect(deleteForUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 when confirmLogin is missing or invalid', async () => {
    const response = await DELETE(makeRequest({ body: {} }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'confirmLogin does not match the authenticated user.' });
  });

  it('returns 403 for cross-origin requests', async () => {
    const response = await DELETE(
      makeRequest({
        origin: 'https://evil.example',
        host: 'app.local',
        body: { confirmLogin: 'alice' },
      }) as never,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Cross-origin requests are not allowed' });
  });

  it('cancels owned running jobs and deletes only caller data', async () => {
    getAllJobsMock.mockResolvedValue([
      { id: 'run-1', userId: 'user-1', status: 'running' },
      { id: 'pending-1', userId: 'user-1', status: 'pending' },
      { id: 'done-1', userId: 'user-1', status: 'completed' },
      { id: 'other-user', userId: 'user-2', status: 'running' },
    ]);
    cancelRunningJobMock.mockImplementation(async (jobId: string) => jobId === 'run-1');
    deleteForUserMock.mockResolvedValue({ deleted: 3 });

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(cancelRunningJobMock).toHaveBeenCalledTimes(2);
    expect(cancelRunningJobMock).toHaveBeenCalledWith('run-1');
    expect(cancelRunningJobMock).toHaveBeenCalledWith('pending-1');
    expect(deleteForUserMock).toHaveBeenCalledWith('user-1');
    expect(clearActivityMock).toHaveBeenCalledWith('user-1');
    expect(deleteDirMock).toHaveBeenCalledWith('users/user-1');
    expect(markUserDeletedMock).toHaveBeenCalledTimes(2);
    expect(body).toEqual({
      success: true,
      summary: {
        jobsCancelled: 1,
        jobsDeleted: 3,
        activityEventsCleared: true,
        storageDirDeleted: true,
      },
    });
  });
});
