/**
 * Tests for the storage route factory's per-user partitioning behaviour.
 *
 * These tests verify the leak-free guarantee: two users hitting the same
 * logical storage route never observe each other's data, unauthenticated
 * requests are rejected, and userIds that aren't safe path segments are
 * refused with a 400 before any filesystem call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const TEST_STORAGE_DIR = path.join(
  os.tmpdir(),
  `flight-school-srf-${Date.now()}-${Math.random().toString(36).slice(2)}`
);
vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', TEST_STORAGE_DIR);

const requireUserContext = vi.fn();
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: () => requireUserContext(),
  UnauthorizedError,
}));

const { createStorageRoute } = await import('./storage-route-factory');
const { logger } = await import('@/lib/logger');

interface Schema {
  items: string[];
}

const DEFAULT_SCHEMA: Schema = { items: [] };

function isSchema(data: unknown): data is Schema {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { items?: unknown }).items)
  );
}

function buildRoute() {
  return createStorageRoute<Schema>({
    filename: 'items.json',
    defaultSchema: DEFAULT_SCHEMA,
    logger: logger.withTag('Test Storage'),
    validateSchema: isSchema,
  });
}

function postRequest(body: Schema): Request {
  return new Request('http://test.local/api/test/storage', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

async function readJson(res: Response): Promise<unknown> {
  return res.json();
}

describe('createStorageRoute (per-user partitioning)', () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_STORAGE_DIR, { recursive: true });
    requireUserContext.mockReset();
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_STORAGE_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('writes two users to two different files on disk for the same logical key', async () => {
    const { POST } = buildRoute();

    requireUserContext.mockResolvedValueOnce({ userId: '111', login: 'a', accessToken: 'ghu_a' });
    const resA = await POST(postRequest({ items: ['alice'] }) as never);
    expect(resA.status).toBe(200);

    requireUserContext.mockResolvedValueOnce({ userId: '222', login: 'b', accessToken: 'ghu_b' });
    const resB = await POST(postRequest({ items: ['bob'] }) as never);
    expect(resB.status).toBe(200);

    const fileA = path.join(TEST_STORAGE_DIR, 'users', '111', 'items.json');
    const fileB = path.join(TEST_STORAGE_DIR, 'users', '222', 'items.json');
    const contentA = JSON.parse(await fs.readFile(fileA, 'utf-8'));
    const contentB = JSON.parse(await fs.readFile(fileB, 'utf-8'));
    expect(contentA).toEqual({ items: ['alice'] });
    expect(contentB).toEqual({ items: ['bob'] });
    expect(fileA).not.toBe(fileB);
  });

  it('user A cannot read user B data via GET (gets default empty schema instead)', async () => {
    const { GET, POST } = buildRoute();

    requireUserContext.mockResolvedValueOnce({ userId: '222', login: 'b', accessToken: 'ghu_b' });
    await POST(postRequest({ items: ['secret-from-bob'] }) as never);

    requireUserContext.mockResolvedValueOnce({ userId: '111', login: 'a', accessToken: 'ghu_a' });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as Schema;
    expect(body).toEqual(DEFAULT_SCHEMA);
    expect(body.items).not.toContain('secret-from-bob');

    // The file under user 111 must NOT contain user 222's data.
    const fileA = path.join(TEST_STORAGE_DIR, 'users', '111', 'items.json');
    const contentA = JSON.parse(await fs.readFile(fileA, 'utf-8'));
    expect(contentA.items).not.toContain('secret-from-bob');
  });

  it('DELETE only clears the caller\'s file, not other users\'', async () => {
    const { POST, DELETE, GET } = buildRoute();

    requireUserContext.mockResolvedValueOnce({ userId: '111', login: 'a', accessToken: 'ghu_a' });
    await POST(postRequest({ items: ['alice'] }) as never);
    requireUserContext.mockResolvedValueOnce({ userId: '222', login: 'b', accessToken: 'ghu_b' });
    await POST(postRequest({ items: ['bob'] }) as never);

    requireUserContext.mockResolvedValueOnce({ userId: '111', login: 'a', accessToken: 'ghu_a' });
    const delRes = await DELETE();
    expect(delRes.status).toBe(200);

    // Bob's file must still exist.
    const fileB = path.join(TEST_STORAGE_DIR, 'users', '222', 'items.json');
    const contentB = JSON.parse(await fs.readFile(fileB, 'utf-8'));
    expect(contentB).toEqual({ items: ['bob'] });

    requireUserContext.mockResolvedValueOnce({ userId: '222', login: 'b', accessToken: 'ghu_b' });
    const getRes = await GET();
    const body = (await readJson(getRes)) as Schema;
    expect(body).toEqual({ items: ['bob'] });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    const { GET, POST, DELETE } = buildRoute();

    requireUserContext.mockRejectedValue(new UnauthorizedError());

    const get = await GET();
    expect(get.status).toBe(401);

    const post = await POST(postRequest({ items: ['x'] }) as never);
    expect(post.status).toBe(401);

    const del = await DELETE();
    expect(del.status).toBe(401);
  });

  it('rejects path-traversal-shaped userIds with 400', async () => {
    const { GET, POST, DELETE } = buildRoute();

    const malicious = ['../foo', '..', '../../etc', 'a/b', '../', '.hidden'];
    for (const bad of malicious) {
      requireUserContext.mockResolvedValueOnce({ userId: bad, login: 'x', accessToken: 'ghu_x' });
      const res = await GET();
      expect(res.status, `userId=${bad} should be rejected`).toBe(400);

      requireUserContext.mockResolvedValueOnce({ userId: bad, login: 'x', accessToken: 'ghu_x' });
      const postRes = await POST(postRequest({ items: ['x'] }) as never);
      expect(postRes.status).toBe(400);

      requireUserContext.mockResolvedValueOnce({ userId: bad, login: 'x', accessToken: 'ghu_x' });
      const delRes = await DELETE();
      expect(delRes.status).toBe(400);
    }

    // No filesystem entries with traversal sequences should have been
    // created under the storage root.
    const usersDir = path.join(TEST_STORAGE_DIR, 'users');
    let entries: string[] = [];
    try {
      entries = await fs.readdir(usersDir);
    } catch {
      // Directory may not exist - that's also fine.
    }
    for (const e of entries) {
      expect(e).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('creates the per-user directory on demand', async () => {
    const { POST } = buildRoute();
    requireUserContext.mockResolvedValueOnce({ userId: '999', login: 'c', accessToken: 'ghu_c' });
    await POST(postRequest({ items: ['ok'] }) as never);

    const userDir = path.join(TEST_STORAGE_DIR, 'users', '999');
    const stat = await fs.stat(userDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('returns 400 when the body fails schema validation (still scoped to user)', async () => {
    const { POST } = buildRoute();
    requireUserContext.mockResolvedValueOnce({ userId: '111', login: 'a', accessToken: 'ghu_a' });
    const badBody = new Request('http://test.local/api/test/storage', {
      method: 'POST',
      body: JSON.stringify({ items: 'not-an-array' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(badBody as never);
    expect(res.status).toBe(400);
  });
});
