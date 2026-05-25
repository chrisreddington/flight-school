import { beforeAll, describe, expect, it } from 'vitest';

import { createWorkerApp } from './app';

describe('createWorkerApp', () => {
  beforeAll(() => {
    process.env.COPILOT_WORKER_SECRET = 'test-secret';
  });

  it('serves /api/health without auth', async () => {
    const app = createWorkerApp();
    const res = await app.request(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('rejects /api/internal/* without bearer token', async () => {
    const app = createWorkerApp();
    const res = await app.request(
      new Request('http://localhost/api/internal/jobs?userId=u1'),
    );
    expect(res.status).toBe(401);
  });
});
