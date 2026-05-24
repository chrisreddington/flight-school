import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireUserContextMock,
  readCredentialsFromJwtMock,
  deleteWorkerActivityMock,
  deleteWorkerJobsForUserMock,
  deleteDirMock,
  markUserDeletedMock,
  clearUserTombstoneMock,
  captureTraceMock,
  UnauthorizedErrorMock,
} = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {}
  return {
    requireUserContextMock: vi.fn(),
    readCredentialsFromJwtMock: vi.fn(),
    deleteWorkerActivityMock: vi.fn(),
    deleteWorkerJobsForUserMock: vi.fn(),
    deleteDirMock: vi.fn(),
    markUserDeletedMock: vi.fn(),
    clearUserTombstoneMock: vi.fn(),
    captureTraceMock: vi.fn(),
    UnauthorizedErrorMock,
  };
});

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  readCredentialsFromJwt: readCredentialsFromJwtMock,
  UnauthorizedError: UnauthorizedErrorMock,
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  captureTracePropagationHeaders: captureTraceMock,
}));

vi.mock('../../ai-activity/worker-client', () => ({
  deleteWorkerActivityForUser: deleteWorkerActivityMock,
}));

vi.mock('../../jobs/worker-client', () => ({
  deleteWorkerJobsForUser: deleteWorkerJobsForUserMock,
}));

vi.mock('@/lib/storage/utils', () => ({
  deleteDir: deleteDirMock,
}));

vi.mock('@/lib/storage/tombstone', () => ({
  markUserDeleted: markUserDeletedMock,
  clearUserTombstone: clearUserTombstoneMock,
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
  deleteWorkerJobsForUserMock.mockResolvedValue({ deleted: 2, cancelled: 0 });
  deleteWorkerActivityMock.mockResolvedValue(undefined);
  captureTraceMock.mockReturnValue({});
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
    expect(deleteWorkerJobsForUserMock).not.toHaveBeenCalled();
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

  it('forwards job deletion to the worker and reports both counts', async () => {
    deleteWorkerJobsForUserMock.mockResolvedValue({ deleted: 3, cancelled: 1 });

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(deleteWorkerJobsForUserMock).toHaveBeenCalledWith('user-1', undefined);
    expect(deleteWorkerActivityMock).toHaveBeenCalledWith('user-1', undefined);
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

  it('reports partial failure when worker activity DELETE fails', async () => {
    deleteWorkerActivityMock.mockRejectedValue(new Error('worker activity down'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary.activityEventsCleared).toBe(false);
    expect(body.summary.partial).toBe(true);
    expect(body.summary.failed).toEqual(['activity']);
    // Storage still wiped despite partial activity failure.
    expect(deleteDirMock).toHaveBeenCalledWith('users/user-1');
  });

  it('rolls back the tombstone and returns 503 when worker delete fails', async () => {
    deleteWorkerJobsForUserMock.mockRejectedValue(new Error('worker down'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Job service temporarily unavailable. Please retry.' });
    expect(markUserDeletedMock).toHaveBeenCalledTimes(1);
    expect(clearUserTombstoneMock).toHaveBeenCalledWith('user-1');
    expect(deleteWorkerActivityMock).not.toHaveBeenCalled();
    expect(deleteDirMock).not.toHaveBeenCalled();
  });
});
