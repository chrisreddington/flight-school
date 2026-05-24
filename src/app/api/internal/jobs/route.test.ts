import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scheduleWorkerJobExecution: vi.fn(),
  jobStorageGet: vi.fn(),
  jobStorageGetAll: vi.fn(),
  jobStorageGetByType: vi.fn(),
  jobStorageCreate: vi.fn(),
  jobStorageCreateIfAbsent: vi.fn(),
  jobStorageMarkFailed: vi.fn(),
  jobStorageInvalidateCache: vi.fn(),
  setTokenIfNewer: vi.fn(),
  withExtractedTraceContext: vi.fn(),
}));

vi.mock('@/worker/jobs/scheduler', () => ({
  scheduleWorkerJobExecution: mocks.scheduleWorkerJobExecution,
}));

vi.mock('@/lib/jobs', () => ({
  jobStorage: {
    get: mocks.jobStorageGet,
    getAll: mocks.jobStorageGetAll,
    getByType: mocks.jobStorageGetByType,
    create: mocks.jobStorageCreate,
    createIfAbsent: mocks.jobStorageCreateIfAbsent,
    markFailed: mocks.jobStorageMarkFailed,
    invalidateCache: mocks.jobStorageInvalidateCache,
  },
}));

vi.mock('@/lib/auth/token-store', () => ({
  getTokenStore: () => ({
    setTokenIfNewer: mocks.setTokenIfNewer,
  }),
}));

vi.mock('@/lib/observability/context-propagation', () => ({
  withExtractedTraceContext: mocks.withExtractedTraceContext,
}));

import { GET, POST } from './route';

const VALID_ID = '11111111-2222-4333-8444-555555555555';

function makeRequest(method: 'POST' | 'GET', { body, token = 'local-secret', query }: { body?: unknown; token?: string; query?: string } = {}) {
  const url = `http://localhost/api/internal/jobs${query ? `?${query}` : ''}`;
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init) as never;
}

function defaultBody(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_ID,
    type: 'chat-response',
    userId: 'user-1',
    input: { threadId: 'thread-1', prompt: 'hello', profile: 'chat' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('COPILOT_WORKER_MODE', '1');
  vi.stubEnv('COPILOT_WORKER_SECRET', 'local-secret');
  mocks.withExtractedTraceContext.mockImplementation(
    async (_h: unknown, op: () => unknown) => op(),
  );
  mocks.jobStorageGet.mockResolvedValue(undefined);
  mocks.jobStorageGetAll.mockResolvedValue([]);
  mocks.jobStorageGetByType.mockResolvedValue([]);
  mocks.jobStorageCreate.mockImplementation(async (job: Record<string, unknown>) => ({
    ...job,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00.000Z',
  }));
  mocks.jobStorageCreateIfAbsent.mockImplementation(
    async (job: Record<string, unknown>, findCollision?: (jobs: Record<string, unknown>) => unknown) => {
      // Default: simulate insert success unless collision predicate finds something.
      // The route may have already done a pre-read; treat that as the by-id check.
      const collision = findCollision ? findCollision({}) : undefined;
      if (collision) {
        return { created: false, existing: collision };
      }
      return {
        created: true,
        job: { ...job, status: 'pending', createdAt: '2024-01-01T00:00:00.000Z' },
      };
    },
  );
  mocks.setTokenIfNewer.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/internal/jobs', () => {
  it('returns 404 when worker mode is disabled', async () => {
    vi.stubEnv('COPILOT_WORKER_MODE', '0');
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(404);
    expect(mocks.jobStorageCreateIfAbsent).not.toHaveBeenCalled();
  });

  it('returns 500 when secret is unconfigured', async () => {
    vi.stubEnv('COPILOT_WORKER_SECRET', '');
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(500);
  });

  it('returns 401 when bearer is wrong', async () => {
    const res = await POST(makeRequest('POST', { body: defaultBody(), token: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid id', async () => {
    const res = await POST(makeRequest('POST', { body: defaultBody({ id: 'not-a-uuid' }) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fields', async () => {
    const res = await POST(makeRequest('POST', { body: { id: VALID_ID } }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for partial credentials', async () => {
    const res = await POST(makeRequest('POST', {
      body: defaultBody({ credentials: { accessToken: 'ghu_x' } }),
    }));
    expect(res.status).toBe(400);
  });

  it('creates a job and schedules executor (success path)', async () => {
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(202);
    expect(mocks.jobStorageCreateIfAbsent).toHaveBeenCalledTimes(1);
    expect(mocks.jobStorageCreateIfAbsent.mock.calls[0][0]).toMatchObject({
      id: VALID_ID,
      type: 'chat-response',
      userId: 'user-1',
    });
    // setImmediate scheduling — flush microtasks + immediate queue.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.scheduleWorkerJobExecution).toHaveBeenCalledTimes(1);
  });

  it('seeds credentials when provided', async () => {
    await POST(makeRequest('POST', {
      body: defaultBody({
        credentials: { accessToken: 'ghu', refreshToken: 'ghr', expiresAt: 1700000000 },
      }),
    }));
    expect(mocks.setTokenIfNewer).toHaveBeenCalledWith('user-1', {
      accessToken: 'ghu',
      refreshToken: 'ghr',
      expiresAt: 1700000000,
    });
  });

  it('idempotent replay returns existing record for same user (200)', async () => {
    const existing = {
      id: VALID_ID,
      userId: 'user-1',
      type: 'chat-response',
      status: 'running',
      input: { prompt: 'hi' },
      createdAt: 'x',
    };
    mocks.jobStorageGet.mockResolvedValueOnce(existing);
    mocks.jobStorageCreateIfAbsent.mockResolvedValueOnce({ created: false, existing });
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(200);
    expect(mocks.jobStorageCreate).not.toHaveBeenCalled();
  });

  it('returns 409 when an existing job belongs to a different user (pre-read fast path)', async () => {
    mocks.jobStorageGet.mockResolvedValueOnce({
      id: VALID_ID,
      userId: 'other-user',
      type: 'chat-response',
      status: 'pending',
      input: {},
      createdAt: 'x',
    });
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json).toEqual({ error: 'Conflict' });
    expect(mocks.jobStorageCreateIfAbsent).not.toHaveBeenCalled();
  });

  it('returns 409 when atomic create finds a different-user collision (TOCTOU tie-break)', async () => {
    // Pre-read sees no record (race window). Atomic createIfAbsent then
    // observes a different-user record landed first.
    mocks.jobStorageGet.mockResolvedValueOnce(undefined);
    mocks.jobStorageCreateIfAbsent.mockResolvedValueOnce({
      created: false,
      existing: {
        id: VALID_ID,
        userId: 'other-user',
        type: 'chat-response',
        status: 'pending',
        input: {},
        createdAt: 'x',
      },
    });
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(409);
  });

  it('dedupes chat-response on (userId, threadId, assistantMessageId) inside atomic create', async () => {
    // The route now forwards a `findCollision` predicate to
    // createIfAbsent. Simulate the mutex-protected scan returning a
    // collision so we never call create.
    const existing = {
      id: 'existing',
      userId: 'user-1',
      type: 'chat-response',
      status: 'running',
      input: { threadId: 'thread-1', assistantMessageId: 'a-1', profile: 'chat' },
      createdAt: 'x',
    };
    mocks.jobStorageCreateIfAbsent.mockImplementationOnce(
      async (_job: unknown, findCollision?: (jobs: Record<string, unknown>) => unknown) => {
        // Predicate must be wired; if absent, the route forgot to pass it.
        if (!findCollision) {
          throw new Error('findCollision predicate was not forwarded');
        }
        return { created: false, existing };
      },
    );
    const res = await POST(makeRequest('POST', {
      body: defaultBody({ input: { threadId: 'thread-1', assistantMessageId: 'a-1', prompt: 'hi', profile: 'chat' } }),
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('existing');
  });

  it('forwards a working findCollision predicate that matches the chat tuple', async () => {
    // Capture the predicate the route passes and assert its behavior
    // matches the documented matcher (pending/running, same user/thread/msg-id).
    let capturedPredicate: ((jobs: Record<string, unknown>) => unknown) | undefined;
    mocks.jobStorageCreateIfAbsent.mockImplementationOnce(
      async (job: Record<string, unknown>, findCollision?: (jobs: Record<string, unknown>) => unknown) => {
        capturedPredicate = findCollision;
        return {
          created: true,
          job: { ...job, status: 'pending', createdAt: '2024-01-01T00:00:00.000Z' },
        };
      },
    );
    await POST(makeRequest('POST', {
      body: defaultBody({ input: { threadId: 'thread-1', assistantMessageId: 'a-1', prompt: 'hi', profile: 'chat' } }),
    }));
    expect(capturedPredicate).toBeTypeOf('function');
    const matching = {
      id: 'other',
      userId: 'user-1',
      type: 'chat-response',
      status: 'running',
      input: { threadId: 'thread-1', assistantMessageId: 'a-1', profile: 'chat' },
    };
    expect(capturedPredicate!({ other: matching })).toBe(matching);
    expect(capturedPredicate!({
      x: { ...matching, userId: 'someone-else' },
    })).toBeUndefined();
    expect(capturedPredicate!({
      x: { ...matching, status: 'completed' },
    })).toBeUndefined();
  });

  it('marks the same job failed if scheduler throws', async () => {
    mocks.scheduleWorkerJobExecution.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await POST(makeRequest('POST', { body: defaultBody() }));
    expect(res.status).toBe(202);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.jobStorageMarkFailed).toHaveBeenCalledWith(
      VALID_ID,
      'Worker executor setup failed',
      'unknown',
    );
  });
});

describe('GET /api/internal/jobs', () => {
  it('requires userId', async () => {
    const res = await GET(makeRequest('GET'));
    expect(res.status).toBe(400);
  });

  it('returns 401 on bad bearer', async () => {
    const res = await GET(makeRequest('GET', { token: 'no', query: 'userId=user-1' }));
    expect(res.status).toBe(401);
  });

  it('filters by userId then type then status, and redacts', async () => {
    mocks.jobStorageGetByType.mockResolvedValueOnce([
      {
        id: 'j1', userId: 'user-1', type: 'chat-response', status: 'running',
        input: { prompt: 'sensitive' }, createdAt: 'x',
      },
      {
        id: 'j2', userId: 'user-2', type: 'chat-response', status: 'running',
        input: { prompt: 'theirs' }, createdAt: 'x',
      },
      {
        id: 'j3', userId: 'user-1', type: 'chat-response', status: 'completed',
        input: { prompt: 's' }, createdAt: 'x',
      },
    ]);
    const res = await GET(makeRequest('GET', {
      query: 'userId=user-1&type=chat-response&status=running',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.jobs).toHaveLength(1);
    expect(json.jobs[0].id).toBe('j1');
    // List DTO does not expose `input`.
    expect(json.jobs[0].input).toBeUndefined();
  });
});
