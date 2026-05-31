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
  getDocumentStoreMock,
  deleteUserDataMock,
  UserDataDeletionErrorMock,
  UnauthorizedErrorMock,
} = vi.hoisted(() => {
  class UnauthorizedErrorMock extends Error {}
  class UserDataDeletionErrorMock extends Error {
    readonly phase: 'partition' | 'registry';
    readonly failedContainers: readonly string[];
    constructor(phase: 'partition' | 'registry', failedContainers: readonly string[], message: string) {
      super(message);
      this.name = 'UserDataDeletionError';
      this.phase = phase;
      this.failedContainers = failedContainers;
    }
  }
  return {
    requireUserContextMock: vi.fn(),
    readCredentialsFromJwtMock: vi.fn(),
    deleteWorkerActivityMock: vi.fn(),
    deleteWorkerJobsForUserMock: vi.fn(),
    deleteDirMock: vi.fn(),
    markUserDeletedMock: vi.fn(),
    clearUserTombstoneMock: vi.fn(),
    captureTraceMock: vi.fn(),
    getDocumentStoreMock: vi.fn(),
    deleteUserDataMock: vi.fn(),
    UserDataDeletionErrorMock,
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

vi.mock('@/lib/storage/document-store/factory', () => ({
  getDocumentStore: getDocumentStoreMock,
}));

vi.mock('@/lib/storage/document-store/account-deletion', () => ({
  deleteUserData: deleteUserDataMock,
  UserDataDeletionError: UserDataDeletionErrorMock,
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
  getDocumentStoreMock.mockResolvedValue({ __store: true });
  deleteUserDataMock.mockResolvedValue(undefined);
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
        storeDataDeleted: true,
      },
    });
  });

  it('wipes document-store partitions after the legacy directory and before the final tombstone re-mark', async () => {
    const callOrder: string[] = [];
    deleteDirMock.mockImplementation(async () => {
      callOrder.push('deleteDir');
    });
    deleteUserDataMock.mockImplementation(async () => {
      callOrder.push('deleteUserData');
    });
    markUserDeletedMock.mockImplementation(async () => {
      callOrder.push('markUserDeleted');
    });

    await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);

    expect(callOrder).toEqual(['markUserDeleted', 'deleteDir', 'deleteUserData', 'markUserDeleted']);
  });

  it('reports a partition-phase failure as store-data with the failed containers and storeDataDeleted false', async () => {
    deleteUserDataMock.mockRejectedValue(
      new UserDataDeletionErrorMock('partition', ['focus', 'threads'], 'partition wipe failed'),
    );

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    // Data may remain, so the wipe is NOT successful and is flagged partial.
    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.summary.storeDataDeleted).toBe(false);
    expect(body.summary.partial).toBe(true);
    expect(body.summary.registryCleanupPending).toBeUndefined();
    expect(body.summary.failed).toEqual(['store-data:focus,threads']);
    // The defensive second tombstone still fires even when the wipe fails.
    expect(markUserDeletedMock).toHaveBeenCalledTimes(2);
  });

  it('reports a registry-phase failure as a completed wipe with registryCleanupPending', async () => {
    // Registry-only failure means the data IS gone; only the owner record
    // lingers, so the wipe is reported as successful and NOT partial (the
    // client may sign out) while flagging the orphaned entry for a sweep.
    deleteUserDataMock.mockRejectedValue(new UserDataDeletionErrorMock('registry', [], 'registry removal failed'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary.storeDataDeleted).toBe(true);
    expect(body.summary.partial).toBeUndefined();
    expect(body.summary.registryCleanupPending).toBe(true);
    expect(body.summary.failed).toEqual(['store-registry']);
    expect(markUserDeletedMock).toHaveBeenCalledTimes(2);
  });

  it('reports a combined activity + partition failure as partial with both causes', async () => {
    deleteWorkerActivityMock.mockRejectedValue(new Error('worker activity down'));
    deleteUserDataMock.mockRejectedValue(
      new UserDataDeletionErrorMock('partition', ['focus'], 'partition wipe failed'),
    );

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.summary.partial).toBe(true);
    expect(body.summary.storeDataDeleted).toBe(false);
    expect(body.summary.activityEventsCleared).toBe(false);
    expect(body.summary.failed).toEqual(['activity', 'store-data:focus']);
    expect(body.summary.registryCleanupPending).toBeUndefined();
  });

  it('suppresses registryCleanupPending when activity data also remains', async () => {
    // Combined failure: the activity-buffer clear fails AND the registry-phase
    // store removal fails. User data (activity) still remains, so the wipe is
    // partial — `registryCleanupPending` must NOT be set (its invariant is
    // "the wipe is complete"), though `store-registry` stays in `failed` for
    // observability.
    deleteWorkerActivityMock.mockRejectedValue(new Error('worker activity down'));
    deleteUserDataMock.mockRejectedValue(new UserDataDeletionErrorMock('registry', [], 'registry removal failed'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.summary.partial).toBe(true);
    expect(body.summary.activityEventsCleared).toBe(false);
    expect(body.summary.storeDataDeleted).toBe(true);
    expect(body.summary.failed).toEqual(['activity', 'store-registry']);
    expect(body.summary.registryCleanupPending).toBeUndefined();
  });

  it('reports partial failure when worker activity DELETE fails', async () => {
    deleteWorkerActivityMock.mockRejectedValue(new Error('worker activity down'));

    const response = await DELETE(makeRequest({ body: { confirmLogin: 'alice' } }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.summary.activityEventsCleared).toBe(false);
    expect(body.summary.partial).toBe(true);
    expect(body.summary.failed).toEqual(['activity']);
    // Storage still wiped despite partial activity failure.
    expect(deleteDirMock).toHaveBeenCalledWith('users/user-1');
    expect(markUserDeletedMock).toHaveBeenCalledTimes(2);
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
