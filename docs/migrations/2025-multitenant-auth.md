# Migration: single-tenant → multi-tenant auth (2025)

Flight School moved from a single-tenant model (one ambient `GITHUB_TOKEN` /
`gh auth` identity) to a multi-tenant model (Auth.js v5 + GitHub App
user-to-server tokens, per-request Octokit, per-session Copilot identity).

This note is for developers pulling the branch onto an existing checkout.

## TL;DR

1. Add `AUTH_*` vars to `.env.local`.
2. Register a GitHub App with callback `http://localhost:3000/api/auth/callback/github`.
3. Stop importing `getGitHubToken()` in request handlers — use
   `requireUserContext()` + `getOctokitForRequest()` instead.
4. Stop calling Copilot session factories without a `SessionIdentity`.

## Environment changes

Add to `.env.local` (see [`.env.example`](../../.env.example)):

```bash
AUTH_SECRET=                  # openssl rand -base64 32
AUTH_GITHUB_ID=               # GitHub App client id
AUTH_GITHUB_SECRET=           # GitHub App client secret
AUTH_TRUST_HOST=true
# Optional, dev only — for hashing user IDs in audit logs
AUDIT_SALT=                   # openssl rand -hex 32
```

`GITHUB_TOKEN` and `gh auth login` are **no longer recognised** by the
application. Local dev requires the same OAuth flow as production: register
a GitHub App, fill in the `AUTH_*` vars, and sign in via the browser. There
are no boot-time fallbacks and no CLI back doors.

## GitHub App registration (local dev)

1. <https://github.com/settings/apps/new>
2. **Homepage URL:** `http://localhost:3000`
3. **Callback URL:** `http://localhost:3000/api/auth/callback/github`
4. Enable **"Request user authorization (OAuth) during installation"**.
5. Generate a client secret; copy client ID and secret into `.env.local`.

## What no longer works

| Symbol / pattern | Status | Replacement |
|---|---|---|
| `process.env.GITHUB_TOKEN` in handlers | Removed | `requireUserContext()` → `accessToken` |
| `getGitHubToken()` | Removed | `requireUserContext()` |
| `isGitHubConfigured()` | Removed | Rely on Auth.js middleware; handlers either get a context or 401 |
| `getAuthMethod()` / `invalidateTokenCache()` | Removed | No process-wide token cache exists |
| `gh auth token` CLI fallback | Removed | Sign in via OAuth even in local dev |
| Module-scope Octokit singleton | Removed | `getOctokitForRequest()` per call |
| `new CopilotClient(...)` in feature code | Forbidden | All Copilot SDK calls run in the worker. From Web/API, dispatch via `executeCopilotChat` / `executeCopilotCoachJob` / `openCopilotAuthoringStreamViaWorker` in `@/lib/copilot/execution`. |
| `createLoggedChatSession` / `createLoggedCoachSession` in feature code | Forbidden | Same as above — these are worker-internal factories. See `.github/skills/copilot-sdk-worker-only/SKILL.md`. |
| Copilot session without `gitHubToken` | Forbidden | Worker dispatch primitives carry the identity automatically. |
| Sharing chat session cache across users | Removed | Cache key now includes `userId` |

## Before / after

### Getting an Octokit in an API route

**Before:**

```typescript
import { getGitHubToken } from '@/lib/github/client';
import { Octokit } from 'octokit';

export async function GET() {
  const token = await getGitHubToken();
  if (!token) return new Response('unauth', { status: 401 });
  const octokit = new Octokit({ auth: token });
  // ...
}
```

**After:**

```typescript
import { getOctokitForRequest } from '@/lib/github/client';
import { UnauthorizedError } from '@/lib/auth/context';

export async function GET() {
  try {
    const octokit = await getOctokitForRequest(); // throws if no session
    // ...
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response('unauth', { status: 401 });
    }
    throw err;
  }
}
```

For AI-backed routes, prefer `withGuardedRoute` (composes `withUserGuards` + standard error mapping):

```typescript
import { withGuardedRoute } from '@/lib/security/guard';

export async function POST(req: Request) {
  return withGuardedRoute(
    { rateLimit: { limit: 30, windowMs: 60_000 }, concurrentCap: 3, eventType: 'copilot.session.create' },
    async (ctx) => {
      const { userId, accessToken } = ctx;
      // ...
    },
  );
}
```

For non-route callers (Server Actions, RSC loaders) use the core directly:

```typescript
import { requireGuardedUserContext } from '@/lib/security/guard';

const { ctx, release } = await requireGuardedUserContext({ eventType: 'habit.update' });
try {
  // ctx.userId, ctx.accessToken, ctx.login
} finally {
  release();
}
```

### Building an MCP server config

**Before:**

```typescript
// MCP config was built once with ambient token
const mcp = getMcpServerConfig(); // implicit token
```

**After:**

```typescript
import { getMcpServerConfig } from '@/lib/copilot/mcp';

const mcp = getMcpServerConfig({ token: accessToken }); // throws if no token
```

`getMcpServerConfig` is now always called per-request inside
`createSessionWithMetrics` — feature code rarely needs to call it directly.

### Creating a Copilot session

**Before:**

```typescript
import { createChatSession } from '@/lib/copilot/server';

const session = await createChatSession();
```

**After:**

```typescript
import { executeCopilotChat } from '@/lib/copilot/execution';
import { requireGuardedUserContext } from '@/lib/security/guard';

const { ctx, release } = await requireGuardedUserContext({
  eventType: 'chat.request',
});
try {
  const result = await executeCopilotChat({
    identity: { userId: ctx.userId, gitHubToken: ctx.accessToken },
    operationName: 'chat',
    prompt,
  });
  return result;
} finally {
  release();
}
```

All Copilot SDK calls execute inside the isolated worker process. From any
Web Frontend or Web API code path, dispatch via the execution primitives
exported from `@/lib/copilot/execution` — `executeCopilotChat`,
`executeCopilotCoachJob`, and `openCopilotAuthoringStreamViaWorker`. The
`scripts/check-copilot-sdk-boundary.mjs` guardrail blocks any direct SDK
or session-factory import outside the worker allowlist. See
`.github/skills/copilot-sdk-worker-only/SKILL.md`.

## Verifying the upgrade

1. `npm install` (Auth.js + dependencies).
2. Fill in `.env.local`.
3. `npm run dev` and visit <http://localhost:3000>.
4. You should be redirected to GitHub to authorize the app on first load.
5. After sign-in, dashboard data and AI features should work as before.

## Related docs

- [`docs/architecture-multitenant.md`](../architecture-multitenant.md)
- [`docs/deployment-aca.md`](../deployment-aca.md)
- [`infra/README.md`](../../infra/README.md)
