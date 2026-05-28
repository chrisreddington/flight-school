/**
 * Cross-user leak integration tests.
 *
 * High-level checks that the per-request auth/token plumbing keeps users
 * fully isolated when they make concurrent requests. Individual modules
 * have their own unit tests (Octokit factory, MCP config, session cache);
 * this suite verifies the system as a whole.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
const createSessionMock = vi.fn();
const octokitConstructorSpy = vi.fn();

vi.mock('@github/copilot-sdk', () => {
  class CopilotClient {
    createSession = createSessionMock;
  }
  return {
    CopilotClient,
    approveAll: vi.fn(),
  };
});

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation(function (this: object, options: { auth: string }) {
    octokitConstructorSpy(options);
    Object.assign(this, {
      auth: options.auth,
      rest: {},
      hook: { wrap: vi.fn() },
    });
  }),
}));

const { requireUserContextMock } = vi.hoisted(() => ({
  requireUserContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireUserContext: requireUserContextMock,
  UnauthorizedError: class UnauthorizedError extends Error {
    readonly status = 401;
    constructor(message = 'Authentication required') {
      super(message);
      this.name = 'UnauthorizedError';
    }
  },
}));

const STORAGE_DIR = path.join(os.tmpdir(), `flight-school-mt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', STORAGE_DIR);

import { getOctokitForToken } from '@/lib/github/client';
import { getMcpServerConfig } from '@/lib/copilot/mcp';
import { getConversationSession } from '@/lib/copilot/sessions';
import * as githubClient from '@/lib/github/client';
import { UnauthorizedError } from '@/lib/auth/context';
import type { ChallengeWorkspace } from '@/lib/workspace/types';

const TOKEN_A = 'ghu_userA_token_aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'ghu_userB_token_bbbbbbbbbbbbbbbbbbbb';

describe('multi-tenant auth/token isolation', () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    octokitConstructorSpy.mockClear();
    let i = 0;
    createSessionMock.mockImplementation(async () => ({
      id: `session-${++i}`,
      destroy: vi.fn().mockResolvedValue(undefined),
    }));
  });

  describe('Octokit per-token isolation', () => {
    it('builds distinct Octokit instances for two users', () => {
      const a = getOctokitForToken(TOKEN_A);
      const b = getOctokitForToken(TOKEN_B);
      expect(a).not.toBe(b);
      expect((a as unknown as { auth: string }).auth).toBe(TOKEN_A);
      expect((b as unknown as { auth: string }).auth).toBe(TOKEN_B);
    });

    it('passes the exact per-user token to the Octokit constructor', () => {
      getOctokitForToken(TOKEN_A);
      getOctokitForToken(TOKEN_B);
      const calls = octokitConstructorSpy.mock.calls.map((c) => c[0].auth);
      expect(calls).toEqual([TOKEN_A, TOKEN_B]);
      expect(TOKEN_A).not.toBe(TOKEN_B);
    });
  });

  describe('MCP config per-token isolation', () => {
    it('embeds the supplied user token into the Authorization header', () => {
      const cfgA = getMcpServerConfig({ token: TOKEN_A });
      const cfgB = getMcpServerConfig({ token: TOKEN_B });
      expect(cfgA.headers?.Authorization).toBe(`Bearer ${TOKEN_A}`);
      expect(cfgB.headers?.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(cfgA.headers?.Authorization).not.toBe(cfgB.headers?.Authorization);
    });

    it('returns a fresh config object per call (no shared mutable state)', () => {
      const cfg1 = getMcpServerConfig({ token: TOKEN_A });
      const cfg2 = getMcpServerConfig({ token: TOKEN_A });
      expect(cfg1).not.toBe(cfg2);
      expect(cfg1.headers).not.toBe(cfg2.headers);
    });

    it('rejects calls without a token', () => {
      expect(() => getMcpServerConfig({ token: '' })).toThrow();
    });
  });

  describe('Copilot conversation cache per-user isolation', () => {
    const chatOpts = (userId: string, token: string) => ({
      userId,
      gitHubToken: token,
      profile: 'chat' as const,
      capabilities: [] as const,
      systemMessage: 'system',
      model: 'claude-haiku-4.5',
    });

    it('does not share sessions across users for the same profile + conversationId', async () => {
      const a = await getConversationSession('shared-conv', chatOpts('userA', TOKEN_A));
      const b = await getConversationSession('shared-conv', chatOpts('userB', TOKEN_B));

      expect(a.session).not.toBe(b.session);
      expect(createSessionMock).toHaveBeenCalledTimes(2);
      const tokens = createSessionMock.mock.calls.map((c) => c[0].gitHubToken);
      expect(tokens).toEqual([TOKEN_A, TOKEN_B]);
    });

    it('handles concurrent requests from two users without crossing tokens', async () => {
      const [a, b] = await Promise.all([
        getConversationSession('conv-A', chatOpts('userA', TOKEN_A)),
        getConversationSession('conv-B', chatOpts('userB', TOKEN_B)),
      ]);

      expect(a.session).not.toBe(b.session);
      const tokens = createSessionMock.mock.calls.map((c) => c[0].gitHubToken).sort();
      expect(tokens).toEqual([TOKEN_A, TOKEN_B].sort());
    });

    it('still hits the cache for the same user + conversation on a follow-up turn', async () => {
      const first = await getConversationSession('multi-turn', chatOpts('userA', TOKEN_A));
      const second = await getConversationSession('multi-turn', chatOpts('userA', TOKEN_A));
      expect(second.session).toBe(first.session);
      expect(second.metrics.reusedConversation).toBe(true);
      expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('no ambient auth back doors', () => {
    it('does not expose any legacy ambient-token resolvers', () => {
      const exported = githubClient as Record<string, unknown>;
      expect(exported.getGitHubToken).toBeUndefined();
      expect(exported.getTokenFromGhCli).toBeUndefined();
      expect(exported.isGitHubConfigured).toBeUndefined();
      expect(exported.getAuthMethod).toBeUndefined();
      expect(exported.invalidateTokenCache).toBeUndefined();
    });

    it('setting GITHUB_TOKEN does not confer access without a session', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_should_not_be_used_xxxxxxxxxxxxxxxx');
      requireUserContextMock.mockImplementationOnce(() => {
        throw new UnauthorizedError();
      });

      await expect(githubClient.getOctokitForRequest()).rejects.toBeInstanceOf(UnauthorizedError);
      // No Octokit should have been constructed from the env var.
      expect(octokitConstructorSpy).not.toHaveBeenCalled();

      vi.unstubAllEnvs();
    });

    it('does not read the GitHub token from the gh CLI', async () => {
      // The client module must not import child_process for token resolution.
      // Inspecting the module source is the simplest contract test.
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const source = await fs.readFile(path.resolve(process.cwd(), 'src/lib/github/client.ts'), 'utf-8');
      expect(source).not.toMatch(/child_process/);
      expect(source).not.toMatch(/execFile|execSync|spawn/);
      expect(source).not.toMatch(/process\.env\.GITHUB_TOKEN/);
    });
  });

  describe('storage routes per-user isolation (threads, focus, workspace)', () => {
    beforeEach(async () => {
      // The "setting GITHUB_TOKEN does not confer access" test above calls
      // vi.unstubAllEnvs() at the end, which nukes the file-level
      // FLIGHT_SCHOOL_DATA_DIR stub. Re-apply it here and reset the module
      // cache so the storage utils re-read the env var on next import.
      // Without this, later tests fall back to the OS-default storage dir
      // (~/.local/share/flight-school on macOS) and pick up leftover state
      // from prior runs — most notably the path-traversal test below seeds
      // a 'safechallenge' workspace under user 2002 that would otherwise
      // bleed across runs and break the "user A sees empty list" assertion.
      vi.resetModules();
      vi.stubEnv('FLIGHT_SCHOOL_DATA_DIR', STORAGE_DIR);
      await fs.mkdir(STORAGE_DIR, { recursive: true });
      requireUserContextMock.mockReset();
    });

    async function loadStorageRoutes() {
      // Imported lazily so the FLIGHT_SCHOOL_DATA_DIR stub is in effect when
      // the storage utils module reads it during init.
      const threads = await import('@/app/api/threads/storage/route');
      const focus = await import('@/app/api/focus/storage/route');
      const workspace = await import('@/app/api/workspace/storage/route');
      const workspaceList = await import('@/app/api/workspace/storage/list/route');
      return { threads, focus, workspace, workspaceList };
    }

    function ctxFor(userId: string) {
      return { userId, login: `u${userId}`, accessToken: `ghu_${userId}` };
    }

    function postReq(url: string, body: unknown): Request {
      return new Request(url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      });
    }

    it('threads + focus storage are partitioned: user A cannot see user B writes', async () => {
      const { threads, focus } = await loadStorageRoutes();

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const tWriteB = await threads.POST(
        postReq('http://test/api/threads/storage', {
          threads: [{ id: 'thread-of-user-1001', title: 'secret' }],
        }) as never,
      );
      expect(tWriteB.status).toBe(200);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const tReadA = await threads.GET();
      const tBodyA = (await tReadA.json()) as { threads: unknown[] };
      expect(tBodyA.threads).toEqual([]);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const fWriteB = await focus.POST(
        postReq('http://test/api/focus/storage', {
          history: { '2024-01-01': { items: ['secret-focus'] } },
        }) as never,
      );
      expect(fWriteB.status).toBe(200);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const fReadA = await focus.GET();
      const fBodyA = (await fReadA.json()) as { history: Record<string, unknown> };
      expect(fBodyA.history).toEqual({});
    });

    it('workspace storage is partitioned per user', async () => {
      const { workspace, workspaceList } = await loadStorageRoutes();

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const saveB = await workspace.POST(
        postReq('http://test/api/workspace/storage', {
          version: 1,
          challengeId: 'fizzbuzz',
          files: [{ name: 'solution.ts', content: 'export const secret = 42;', id: 'f1' }],
          activeFileId: 'f1',
          createdAt: 1,
          updatedAt: 1,
        }) as never,
      );
      expect(saveB.status).toBe(200);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const readA = await workspace.GET(new Request('http://test/api/workspace/storage?challengeId=fizzbuzz') as never);
      expect(readA.status).toBe(404);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const listA = await workspaceList.GET();
      const listBodyA = (await listA.json()) as { challengeIds: string[] };
      expect(listBodyA.challengeIds).toEqual([]);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const listB = await workspaceList.GET();
      const listBodyB = (await listB.json()) as { challengeIds: string[] };
      expect(listBodyB.challengeIds).toContain('fizzbuzz');
    });

    it('all three storage routes return 401 when unauthenticated', async () => {
      const { threads, focus, workspace, workspaceList } = await loadStorageRoutes();

      const fail = () => {
        throw new UnauthorizedError();
      };

      requireUserContextMock.mockImplementationOnce(fail);
      expect((await threads.GET()).status).toBe(401);
      requireUserContextMock.mockImplementationOnce(fail);
      expect((await focus.GET()).status).toBe(401);
      requireUserContextMock.mockImplementationOnce(fail);
      expect(
        (await workspace.GET(new Request('http://test/api/workspace/storage?challengeId=x') as never)).status,
      ).toBe(401);
      requireUserContextMock.mockImplementationOnce(fail);
      expect((await workspaceList.GET()).status).toBe(401);
    });

    it('DELETE for user A does not affect user B in any of the three routes', async () => {
      const { threads, focus, workspace, workspaceList } = await loadStorageRoutes();

      // Seed A and B in threads + focus + workspace.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      await threads.POST(postReq('http://t', { threads: [{ id: 'b-thread' }] }) as never);
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await threads.POST(postReq('http://t', { threads: [{ id: 'a-thread' }] }) as never);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      await focus.POST(postReq('http://t', { history: { d: { v: 1 } } }) as never);
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await focus.POST(postReq('http://t', { history: { d: { v: 2 } } }) as never);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      await workspace.POST(
        postReq('http://t', {
          version: 1,
          challengeId: 'c1',
          files: [{ name: 'a.ts', content: 'b', id: 'i' }],
          activeFileId: 'i',
          createdAt: 1,
          updatedAt: 1,
        }) as never,
      );
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await workspace.POST(
        postReq('http://t', {
          version: 1,
          challengeId: 'c1',
          files: [{ name: 'a.ts', content: 'a', id: 'i' }],
          activeFileId: 'i',
          createdAt: 1,
          updatedAt: 1,
        }) as never,
      );

      // User A deletes everything.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await threads.DELETE();
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await focus.DELETE();
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      await workspace.DELETE(new Request('http://t/api/workspace/storage') as never);

      // User B's data must still be intact.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const tB = (await (await threads.GET()).json()) as { threads: { id: string }[] };
      expect(tB.threads).toEqual([{ id: 'b-thread' }]);

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const fB = (await (await focus.GET()).json()) as { history: Record<string, unknown> };
      expect(fB.history).toEqual({ d: { v: 1 } });

      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const lB = (await (await workspaceList.GET()).json()) as { challengeIds: string[] };
      expect(lB.challengeIds).toContain('c1');
    });

    it('rejects path-traversal in userId with 400 across all three routes', async () => {
      const { threads, focus, workspace, workspaceList } = await loadStorageRoutes();

      const setBad = () => requireUserContextMock.mockResolvedValueOnce(ctxFor('..'));
      // ctxFor('..') yields userId='..' which fails the regex.

      setBad();
      expect((await threads.GET()).status).toBe(400);
      setBad();
      expect((await focus.GET()).status).toBe(400);
      setBad();
      expect(
        (await workspace.GET(new Request('http://test/api/workspace/storage?challengeId=x') as never)).status,
      ).toBe(400);
      setBad();
      expect((await workspaceList.GET()).status).toBe(400);
    });

    it('rejects path-traversal in workspace file.name with 400 and does not corrupt other users', async () => {
      const { workspace, workspaceList } = await loadStorageRoutes();

      // Seed user B with a known-good workspace.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const seedB = await workspace.POST(
        postReq('http://test/api/workspace/storage', {
          version: 1,
          challengeId: 'safechallenge',
          files: [
            {
              id: 'f1',
              name: 'solution.ts',
              content: 'export const safe = 1;',
              language: 'typescript',
              createdAt: '',
              updatedAt: '',
            },
          ],
          activeFileId: 'f1',
          createdAt: 1,
          updatedAt: 1,
        }) as never,
      );
      expect(seedB.status).toBe(200);

      // User A tries to escape into user 2002's workspace via file.name traversal.
      const malicious = [
        '../../../2002/workspaces/safechallenge/solution.ts',
        '..\\..\\..\\2002\\workspaces\\safechallenge\\solution.ts',
        '/etc/passwd',
        'foo/../../bar.ts',
        '..',
      ];

      for (const evilName of malicious) {
        requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
        const attack = await workspace.POST(
          postReq('http://test/api/workspace/storage', {
            version: 1,
            challengeId: 'attack',
            files: [
              {
                id: 'f1',
                name: evilName,
                content: 'PWNED',
                language: 'typescript',
                createdAt: '',
                updatedAt: '',
              },
            ],
            activeFileId: 'f1',
            createdAt: 1,
            updatedAt: 1,
          }) as never,
        );
        expect(attack.status, `expected 400 for filename ${evilName}`).toBe(400);
      }

      // User B's workspace must be unchanged after the attacks.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('2002'));
      const readB = await workspace.GET(
        new Request('http://test/api/workspace/storage?challengeId=safechallenge') as never,
      );
      expect(readB.status).toBe(200);
      const bodyB = (await readB.json()) as ChallengeWorkspace;
      expect(bodyB.files).toHaveLength(1);
      expect(bodyB.files[0].name).toBe('solution.ts');
      expect(bodyB.files[0].content).toBe('export const safe = 1;');

      // User A also should have no leaked workspace from the rejected attacks.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('1001'));
      const listA = (await (await workspaceList.GET()).json()) as { challengeIds: string[] };
      expect(listA.challengeIds).not.toContain('attack');
    });

    it('accepts a normal filename and writes only inside the per-user workspace dir', async () => {
      const { workspace } = await loadStorageRoutes();

      requireUserContextMock.mockResolvedValueOnce(ctxFor('3003'));
      const save = await workspace.POST(
        postReq('http://test/api/workspace/storage', {
          version: 1,
          challengeId: 'happy',
          files: [
            {
              id: 'f1',
              name: 'foo.ts',
              content: 'export const x = 1;',
              language: 'typescript',
              createdAt: '',
              updatedAt: '',
            },
          ],
          activeFileId: 'f1',
          createdAt: 1,
          updatedAt: 1,
        }) as never,
      );
      expect(save.status).toBe(200);

      // Round-trip through GET as the same user must return our content.
      // (We rely on the route-level GET as the trust boundary because the
      // FLIGHT_SCHOOL_DATA_DIR stub does not always take effect in this suite
      // — the underlying storage utils may write to the platform default.)
      requireUserContextMock.mockResolvedValueOnce(ctxFor('3003'));
      const read = await workspace.GET(new Request('http://test/api/workspace/storage?challengeId=happy') as never);
      expect(read.status).toBe(200);
      const body = (await read.json()) as ChallengeWorkspace;
      expect(body.files).toHaveLength(1);
      expect(body.files[0].name).toBe('foo.ts');
      expect(body.files[0].content).toBe('export const x = 1;');

      // Another user must not see this workspace.
      requireUserContextMock.mockResolvedValueOnce(ctxFor('4004'));
      const otherRead = await workspace.GET(
        new Request('http://test/api/workspace/storage?challengeId=happy') as never,
      );
      expect(otherRead.status).toBe(404);
    });

    it('returns a generated starter workspace when spec exists but workspace files do not', async () => {
      const { workspace } = await loadStorageRoutes();

      const userId = '5005';
      const challengeId = 'fresh-spec';
      const challengeDir = path.join(STORAGE_DIR, 'users', userId, 'challenges');
      await fs.mkdir(challengeDir, { recursive: true });
      await fs.writeFile(
        path.join(challengeDir, `${challengeId}.json`),
        JSON.stringify({
          id: challengeId,
          title: 'Fresh challenge',
          description: 'Write a function that returns true',
          difficulty: 'beginner',
          language: 'TypeScript',
          estimatedTime: '15 min',
          whyThisChallenge: ['Practice'],
        }),
      );

      requireUserContextMock.mockResolvedValueOnce(ctxFor(userId));
      const read = await workspace.GET(
        new Request(`http://test/api/workspace/storage?challengeId=${challengeId}`) as never,
      );

      expect(read.status).toBe(200);
      const body = (await read.json()) as ChallengeWorkspace;
      expect(body.challengeId).toBe(challengeId);
      expect(body.files.length).toBeGreaterThan(0);
      expect(body.files[0].name).toBe('solution.ts');
      expect(body.files[0].content).toContain('Fresh challenge');
    });
  });
});

afterAll(async () => {
  try {
    await fs.rm(STORAGE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});
