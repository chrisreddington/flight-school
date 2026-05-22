# Copilot Worker Service Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local HTTP worker path and production ACA worker scaffold for Copilot chat execution while preserving the in-process fallback.

**Architecture:** The web app will call `executeCopilotChat()`, which selects either the existing in-process adapter or an authenticated HTTP worker client based on `COPILOT_WORKER_URL`. The worker is implemented as the same Next.js image running in worker mode with a private internal route, so local and ACA deployments exercise a real process boundary without creating a second build pipeline.

**Tech Stack:** Next.js App Router API routes, TypeScript, Vitest, GitHub Copilot SDK, Aspire TypeScript AppHost, Azure Container Apps Bicep.

---

## Resumption Section
- **Scope**: Implements `docs/superpowers/specs/2026-05-22-copilot-worker-service-foundation-design.md`.
- **Current Phase**: Plan ready for review/execution.
- **Next Action**: Execute Task 1 with TDD.
- **Blockers**: None.

## From Spec
- **Stories**: S1 local worker, S2 typed worker protocol, S3 private ACA worker scaffold, S4 docs, S5 deferred queue boundary.
- **Migration Strategy**: Transport indirection first; private worker scaffold second; durable async queue later.
- **Key decisions**: HTTP worker transport; in-process fallback; chat execution first; same image for web + worker.
- **Security condition**: Worker route must be disabled unless `COPILOT_WORKER_ENABLED=1` and must require `Authorization: Bearer ${COPILOT_WORKER_SECRET}`.

## Codebase Analysis
| # | File | Role | Change |
|---|---|---|---|
| F1 | `src/lib/copilot/execution/config.ts` | Worker env config | Read/validate worker URL + shared secret. |
| F2 | `src/lib/copilot/execution/http-client.ts` | Worker transport | POST chat requests to internal worker route. |
| F3 | `src/lib/copilot/execution/index.ts` | Execution selector | Choose worker client when configured, otherwise in-process. |
| F4 | `src/lib/copilot/execution/protocol.ts` | Runtime validation | Validate worker request payloads without `any`. |
| F5 | `src/lib/copilot/execution/*.test.ts` | Unit tests | Cover config, selector, HTTP transport, protocol. |
| F6 | `src/app/api/internal/copilot/execute/route.ts` | Worker endpoint | Authenticated internal route executing in-process adapter. |
| F7 | `src/app/api/internal/copilot/execute/route.test.ts` | Route tests | Reject disabled/unauthorized/invalid; accept valid request. |
| F8 | `package.json` | Local scripts | Add `dev:worker`. |
| F9 | `.env.example` | Local config docs | Document worker URL/secret/enabled vars. |
| F10 | `apphost.ts` / `aspire-modules.d.ts` | Local orchestration | Add worker app and inject URL/secret into web app. |
| F11 | `infra/modules/copilot-worker-app.bicep` | ACA worker | Private internal Container App for worker mode. |
| F12 | `infra/modules/container-app.bicep` | ACA web | Add worker URL + secret env refs. |
| F13 | `infra/main.bicep` | Infra wiring | Deploy worker before web; grant KV access to both identities. |
| F14 | `infra/README.md`, `docs/*.md`, `README.md` | Docs | Local and production worker instructions. |

## Implementation Steps

### Task 1: Add worker config, protocol validation, and HTTP client

**Files:**
- Create: `src/lib/copilot/execution/config.ts`
- Create: `src/lib/copilot/execution/http-client.ts`
- Create: `src/lib/copilot/execution/protocol.ts`
- Create: `src/lib/copilot/execution/config.test.ts`
- Create: `src/lib/copilot/execution/http-client.test.ts`
- Create: `src/lib/copilot/execution/protocol.test.ts`

- [ ] **Step 1.1: Write failing config tests**

Create `src/lib/copilot/execution/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCopilotWorkerConfig } from './config';

describe('getCopilotWorkerConfig', () => {
  it('returns null when no worker URL is configured', () => {
    expect(getCopilotWorkerConfig({})).toBeNull();
  });

  it('requires a worker secret when worker URL is configured', () => {
    expect(() => getCopilotWorkerConfig({ COPILOT_WORKER_URL: 'http://localhost:3001' }))
      .toThrow('COPILOT_WORKER_SECRET is required when COPILOT_WORKER_URL is set');
  });

  it('normalizes trailing slashes from the worker URL', () => {
    expect(getCopilotWorkerConfig({
      COPILOT_WORKER_URL: 'http://localhost:3001/',
      COPILOT_WORKER_SECRET: 'local-secret',
    })).toEqual({ baseUrl: 'http://localhost:3001', secret: 'local-secret' });
  });
});
```

- [ ] **Step 1.2: Write failing protocol tests**

Create `src/lib/copilot/execution/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCopilotWorkerChatRequest } from './protocol';

describe('parseCopilotWorkerChatRequest', () => {
  it('accepts valid chat execution requests', () => {
    const request = parseCopilotWorkerChatRequest({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      useGitHubTools: false,
      conversationId: 'thread-1',
    });

    expect(request).toEqual({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      useGitHubTools: false,
      conversationId: 'thread-1',
    });
  });

  it('rejects missing identity token', () => {
    expect(() => parseCopilotWorkerChatRequest({
      identity: { userId: '123' },
      prompt: 'hello',
    })).toThrow('identity.gitHubToken is required');
  });
});
```

- [ ] **Step 1.3: Write failing HTTP client tests**

Create `src/lib/copilot/execution/http-client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCopilotChatViaWorker } from './http-client';

describe('executeCopilotChatViaWorker', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('posts chat execution requests to the worker with bearer auth', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      response: 'answer',
      toolCalls: [],
      meta: {
        generatedAt: '2026-05-22T18:00:00.000Z',
        model: 'claude-haiku-4.5',
        toolsUsed: [],
        totalTimeMs: 10,
        usedGitHubTools: false,
        sessionCreateMs: null,
        sessionPoolHit: null,
        mcpEnabled: null,
        sessionReused: null,
      },
    }), { status: 200 }));

    const result = await executeCopilotChatViaWorker(
      { baseUrl: 'http://localhost:3001', secret: 'local-secret' },
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' },
    );

    expect(result.response).toBe('answer');
    expect(fetch).toHaveBeenCalledWith('http://localhost:3001/api/internal/copilot/execute', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ authorization: 'Bearer local-secret' }),
    }));
  });

  it('throws a worker error when the worker returns non-2xx', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }));

    await expect(executeCopilotChatViaWorker(
      { baseUrl: 'http://localhost:3001', secret: 'local-secret' },
      { identity: { userId: '123', gitHubToken: 'ghu_user' }, prompt: 'hello' },
    )).rejects.toThrow('Copilot worker returned HTTP 400: bad request');
  });
});
```

- [ ] **Step 1.4: Run tests to verify RED**

Run:

```bash
npm test -- --run src/lib/copilot/execution/config.test.ts src/lib/copilot/execution/protocol.test.ts src/lib/copilot/execution/http-client.test.ts
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 1.5: Implement minimal config, protocol, and client**

Create the modules with these public signatures:

```ts
export interface CopilotWorkerConfig {
  baseUrl: string;
  secret: string;
}

export function getCopilotWorkerConfig(env = process.env): CopilotWorkerConfig | null;
export function parseCopilotWorkerChatRequest(value: unknown): CopilotChatExecutionRequest;
export function executeCopilotChatViaWorker(config: CopilotWorkerConfig, request: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult>;
```

Implementation notes:
- Trim one or more trailing `/` characters from `COPILOT_WORKER_URL`.
- Throw when URL is set and `COPILOT_WORKER_SECRET` is empty.
- Use lowercase `authorization` and `content-type` headers.
- Parse worker error JSON `{ error: string }`; fall back to response text if JSON parsing fails.
- Validate response shape enough to avoid returning non-object or missing `response`/`meta`.

- [ ] **Step 1.6: Run tests to verify GREEN**

Run the same focused command from Step 1.4. Expected: PASS.

- [ ] **Step 1.7: Commit Task 1**

```bash
git add src/lib/copilot/execution/config.ts src/lib/copilot/execution/http-client.ts src/lib/copilot/execution/protocol.ts src/lib/copilot/execution/config.test.ts src/lib/copilot/execution/http-client.test.ts src/lib/copilot/execution/protocol.test.ts
git commit -m "feat: add copilot worker http protocol" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Route chat execution through worker when configured

**Files:**
- Modify: `src/lib/copilot/execution/index.ts`
- Create: `src/lib/copilot/execution/index.test.ts`

- [ ] **Step 2.1: Write failing selector tests**

Create `src/lib/copilot/execution/index.test.ts` with hoisted mocks for `./config`, `./http-client`, and `./in-process`. Cover:
- no worker config calls `executeCopilotChatInProcess`;
- worker config calls `executeCopilotChatViaWorker`;
- worker client failures propagate and do not fall back.

Use this expected import surface:

```ts
import { executeCopilotChat } from './index';
```

- [ ] **Step 2.2: Run selector test to verify RED**

Run: `npm test -- --run src/lib/copilot/execution/index.test.ts`

Expected: FAIL because `index.ts` still directly re-exports the in-process function.

- [ ] **Step 2.3: Rename the in-process export and implement selector**

Change `src/lib/copilot/execution/in-process.ts` to export:

```ts
export async function executeCopilotChatInProcess(request: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult>
```

Then update `src/lib/copilot/execution/index.ts`:

```ts
import { getCopilotWorkerConfig } from './config';
import { executeCopilotChatViaWorker } from './http-client';
import { executeCopilotChatInProcess } from './in-process';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';

export async function executeCopilotChat(request: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult> {
  const workerConfig = getCopilotWorkerConfig();
  if (workerConfig) {
    return executeCopilotChatViaWorker(workerConfig, request);
  }
  return executeCopilotChatInProcess(request);
}
```

Update existing imports/tests that referenced `executeCopilotChat` from `./in-process`.

- [ ] **Step 2.4: Run focused execution tests**

Run:

```bash
npm test -- --run src/lib/copilot/execution/index.test.ts src/lib/copilot/execution/in-process.test.ts src/app/api/copilot/route.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Commit Task 2**

```bash
git add src/lib/copilot/execution src/app/api/copilot/route.test.ts
git commit -m "feat: select copilot worker execution when configured" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add the internal worker route

**Files:**
- Create: `src/app/api/internal/copilot/execute/route.ts`
- Create: `src/app/api/internal/copilot/execute/route.test.ts`

- [ ] **Step 3.1: Write failing worker route tests**

Create route tests that:
- return 404 when `COPILOT_WORKER_ENABLED !== '1'`;
- return 401 when bearer token is missing or wrong;
- return 400 for invalid request body;
- call `executeCopilotChatInProcess` and return its result for a valid request.

Mock `@/lib/copilot/execution/in-process` and use `new Request(...) as never` like existing route tests.

- [ ] **Step 3.2: Run route test to verify RED**

Run: `npm test -- --run src/app/api/internal/copilot/execute/route.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3.3: Implement worker route**

Route behavior:
- If `process.env.COPILOT_WORKER_ENABLED !== '1'`, return `NextResponse.json({ error: 'Not found' }, { status: 404 })`.
- Compare `Authorization` header to `Bearer ${process.env.COPILOT_WORKER_SECRET}`.
- If secret is missing in worker mode, return 500 with `"COPILOT_WORKER_SECRET is not configured"`.
- Parse JSON with `parseJsonBody<unknown>()`, validate with `parseCopilotWorkerChatRequest()`.
- Execute `executeCopilotChatInProcess(validatedRequest)`.

- [ ] **Step 3.4: Run route and execution tests**

Run:

```bash
npm test -- --run src/app/api/internal/copilot/execute/route.test.ts src/lib/copilot/execution/http-client.test.ts src/lib/copilot/execution/index.test.ts
```

Expected: PASS.

- [ ] **Step 3.5: Commit Task 3**

```bash
git add src/app/api/internal/copilot/execute src/lib/copilot/execution
git commit -m "feat: add internal copilot worker route" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add local worker scripts and Aspire orchestration

**Files:**
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `apphost.ts`
- Modify: `aspire-modules.d.ts`

- [ ] **Step 4.1: Update scripts and env docs**

Add scripts:

```json
"dev:worker": "next dev --port 3001",
"dev:web-worker": "COPILOT_WORKER_URL=http://localhost:3001 COPILOT_WORKER_SECRET=local-dev-worker-secret npm run dev"
```

Add `.env.example` entries:

```bash
# Optional local/prod worker boundary.
# Leave COPILOT_WORKER_URL unset to use the in-process adapter.
# COPILOT_WORKER_URL=http://localhost:3001
# COPILOT_WORKER_SECRET=local-dev-worker-secret
# COPILOT_WORKER_ENABLED=1
```

- [ ] **Step 4.2: Update Aspire AppHost**

Add a second Next.js resource:

```ts
const workerSecret = 'local-dev-worker-secret';
const copilotWorker = await builder
  .addNextJsApp('copilot-worker', '.', { runScriptName: 'dev:worker' })
  .withHttpEndpoint({ port: 3001, targetPort: 3001, isProxied: false })
  .withEnvironment('COPILOT_WORKER_ENABLED', '1')
  .withEnvironment('COPILOT_WORKER_SECRET', workerSecret);

const workerEndpoint = await copilotWorker.getEndpoint('http');
// Pass the endpoint reference directly; Aspire resolves it at run time.
flightSchool
  .withEnvironment('COPILOT_WORKER_URL', workerEndpoint)
  .withEnvironment('COPILOT_WORKER_SECRET', workerSecret);
```

If TypeScript rejects the fluent chain type, update `aspire-modules.d.ts` to include `withEnvironment` and `withHttpEndpoint` on `NextJsAppResource`.

- [ ] **Step 4.3: Validate AppHost TypeScript**

Run: `npm run aspire:build`

Expected: PASS.

- [ ] **Step 4.4: Commit Task 4**

```bash
git add package.json .env.example apphost.ts aspire-modules.d.ts
git commit -m "feat: add local copilot worker orchestration" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Scaffold private ACA worker infrastructure

**Files:**
- Create: `infra/modules/copilot-worker-app.bicep`
- Modify: `infra/modules/container-app.bicep`
- Modify: `infra/modules/key-vault.bicep`
- Modify: `infra/main.bicep`
- Modify: `infra/main.parameters.json`

- [ ] **Step 5.1: Add worker secret to Key Vault docs/module comments**

In `infra/modules/key-vault.bicep`, add `copilot-worker-secret` to the manual secret list. Do not generate it in Bicep; operators will set it with `openssl rand -base64 32`.

- [ ] **Step 5.2: Create private worker Container App module**

Create `infra/modules/copilot-worker-app.bicep` based on `container-app.bicep` with these differences:
- name: `${appName}-worker`;
- ingress: `{ external: false, targetPort: 3000, transport: 'auto' }`;
- env includes `COPILOT_WORKER_ENABLED=1`, `COPILOT_WORKER_SECRET` secret ref, `PORT=3000`, token-store/App Insights env, and auth secrets;
- output `fqdn` and `principalId`.

- [ ] **Step 5.3: Add web worker URL/secret env**

In `infra/modules/container-app.bicep`:
- add params `copilotWorkerUrl string = ''`;
- add Key Vault secret ref `copilot-worker-secret`;
- add env `{ name: 'COPILOT_WORKER_URL', value: copilotWorkerUrl }`;
- add env `{ name: 'COPILOT_WORKER_SECRET', secretRef: 'copilot-worker-secret' }`.

- [ ] **Step 5.4: Wire modules in `infra/main.bicep`**

Order:
1. deploy worker module after Key Vault and environment;
2. pass `copilotWorkerUrl: 'https://${copilotWorker.outputs.fqdn}'` into web module;
3. add a second `key-vault-role-assignment` module for `copilotWorker.outputs.principalId`;
4. output `copilotWorkerFqdn`.

- [ ] **Step 5.5: Validate Bicep**

Run:

```bash
az bicep build --file infra/main.bicep --stdout >/dev/null
```

Expected: PASS.

- [ ] **Step 5.6: Commit Task 5**

```bash
git add infra/main.bicep infra/main.parameters.json infra/modules/container-app.bicep infra/modules/copilot-worker-app.bicep infra/modules/key-vault.bicep
git commit -m "infra: scaffold private copilot worker app" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Update docs for local and production worker paths

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture-multitenant.md`
- Modify: `docs/deployment-aca.md`
- Modify: `infra/README.md`
- Modify: `docs/superpowers/specs/2026-05-22-copilot-worker-service-foundation-design.md`

- [ ] **Step 6.1: Document local worker**

Add local commands:

```bash
npm run dev:worker
COPILOT_WORKER_URL=http://localhost:3001 \
COPILOT_WORKER_SECRET=local-dev-worker-secret \
npm run dev
```

Also document `npm run aspire:run` as the preferred local two-process path once AppHost wiring is present.

- [ ] **Step 6.2: Document production scaffold**

In ACA/infra docs, add:
- set `copilot-worker-secret` in Key Vault;
- public web app has external ingress;
- worker app uses internal ingress;
- Service Bus async job execution is still deferred;
- worker URL is an internal ACA FQDN injected by Bicep.

- [ ] **Step 6.3: Mark spec status**

Update the worker service foundation spec status to `Foundation Implemented` only after Tasks 1-5 are committed.

- [ ] **Step 6.4: Run doc diff check**

Run: `git --no-pager diff --check`

Expected: PASS.

- [ ] **Step 6.5: Commit Task 6**

```bash
git add README.md docs/architecture-multitenant.md docs/deployment-aca.md infra/README.md docs/superpowers/specs/2026-05-22-copilot-worker-service-foundation-design.md
git commit -m "docs: document copilot worker service foundation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Final validation

**Files:**
- No new files.

- [ ] **Step 7.1: Run TypeScript, lint, tests, build, maintainability**

Run:

```bash
npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check
```

Expected: exit 0.

- [ ] **Step 7.2: Run infra/AppHost validation**

Run:

```bash
npm run aspire:build
az bicep build --file infra/main.bicep --stdout >/dev/null
```

Expected: both exit 0.

- [ ] **Step 7.3: Check working tree**

Run: `git --no-pager status --short`

Expected: no output.

## Verification Commands Summary
| Step | Command | Expected |
|---|---|---|
| 1.4 | `npm test -- --run src/lib/copilot/execution/config.test.ts src/lib/copilot/execution/protocol.test.ts src/lib/copilot/execution/http-client.test.ts` | FAIL before implementation |
| 1.6 | Same as 1.4 | PASS |
| 2.2 | `npm test -- --run src/lib/copilot/execution/index.test.ts` | FAIL before selector |
| 2.4 | `npm test -- --run src/lib/copilot/execution/index.test.ts src/lib/copilot/execution/in-process.test.ts src/app/api/copilot/route.test.ts` | PASS |
| 3.2 | `npm test -- --run src/app/api/internal/copilot/execute/route.test.ts` | FAIL before route |
| 3.4 | `npm test -- --run src/app/api/internal/copilot/execute/route.test.ts src/lib/copilot/execution/http-client.test.ts src/lib/copilot/execution/index.test.ts` | PASS |
| 4.3 | `npm run aspire:build` | PASS |
| 5.5 | `az bicep build --file infra/main.bicep --stdout >/dev/null` | PASS |
| 6.4 | `git --no-pager diff --check` | PASS |
| 7.1 | `npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check` | PASS |
| 7.2 | `npm run aspire:build && az bicep build --file infra/main.bicep --stdout >/dev/null` | PASS |

## Rollback Plan
| Task | Rollback |
|---|---|
| Task 1 | Revert commit titled `feat: add copilot worker http protocol`. |
| Task 2 | Revert commit titled `feat: select copilot worker execution when configured`. |
| Task 3 | Revert commit titled `feat: add internal copilot worker route`. |
| Task 4 | Revert commit titled `feat: add local copilot worker orchestration`. |
| Task 5 | Revert commit titled `infra: scaffold private copilot worker app`. |
| Task 6 | Revert commit titled `docs: document copilot worker service foundation`. |

## Specialist Sign-Off
| Specialist | Status | Notes |
|---|---|---|
| Architecture | approve | Same-image worker mode validates the process boundary without a second build pipeline. |
| Security | approve with condition | Shared-secret auth and worker-mode gate are required even with private ACA ingress. |
| Operations | concern | Bicep internal FQDN and Aspire endpoint injection must be validated before claiming scaffold complete. |

## Execution Handoff
- **Start At**: Task 1.
- **Recommended Mode**: Inline execution in this session because the tasks are sequential and touch shared execution/infra contracts.
- **Final Verification**: Task 7 commands.
