# Local Per-user Copilot Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local worker mode execute Copilot chat through one SDK-spawned CLI process and `COPILOT_HOME` per GitHub user.

**Architecture:** Extend the existing runtime pool so each runtime owns a user-scoped `CopilotClient`, then route worker chat execution through that pool. The web fallback remains unchanged: only `/api/_internal/copilot/execute` uses the per-user runtime executor.

**Tech Stack:** Next.js App Router API routes, TypeScript, Vitest, `@github/copilot-sdk@1.0.0-beta.4`, existing Copilot session/logging helpers.

---

## Resumption Section
- **Scope**: Implements `docs/superpowers/specs/2026-05-22-local-per-user-copilot-runtime-design.md`.
- **Current Phase**: Plan ready for execution.
- **Next Action**: Execute Task 1 with TDD.
- **Blockers**: None.

## From Spec
- **Stories**: S1 per-user runtime creation, S2 worker route uses runtime pool, S3 caps/cleanup, S4 SDK capability docs.
- **Key SDK finding**: Installed SDK supports SDK-spawned CLI isolation with `copilotHome`, `gitHubToken`, and `useLoggedInUser:false`; it rejects `cliUrl + gitHubToken`.
- **Migration Strategy**: Worker route only; web in-process fallback unchanged.

## Codebase Analysis
| # | File | Role | Change |
|---|---|---|---|
| F1 | `src/lib/copilot/runtime/config.ts` | Runtime config | Parse TTL, max active, and home root. |
| F2 | `src/lib/copilot/runtime/user-home.ts` | Path safety | Build safe per-user `COPILOT_HOME` paths. |
| F3 | `src/lib/copilot/runtime/types.ts` | Runtime contract | Add context-aware pool creation, `copilotHome`, and `executeChat`. |
| F4 | `src/lib/copilot/runtime/session-executor.ts` | Shared execution | Turn a provided Copilot session factory into `CopilotChatExecutionResult`. |
| F5 | `src/lib/copilot/execution/in-process.ts` | Fallback adapter | Reuse `session-executor` to avoid drift. |
| F6 | `src/lib/copilot/runtime/user-runtime.ts` | Per-user runtime | Create SDK `CopilotClient`, sessions, and shutdown logic. |
| F7 | `src/lib/copilot/runtime/worker-executor.ts` | Worker entry point | Get runtime from pool and execute chat. |
| F8 | `src/app/api/_internal/copilot/execute/route.ts` | Internal route | Call worker runtime executor instead of in-process adapter. |
| F9 | `README.md`, `docs/architecture-multitenant.md`, design spec | Docs | Document actual local per-user runtime behavior and SDK constraints. |

## Implementation Steps

### Task 1: Add runtime config and per-user home paths

**Files:**
- Create: `src/lib/copilot/runtime/config.ts`
- Create: `src/lib/copilot/runtime/config.test.ts`
- Create: `src/lib/copilot/runtime/user-home.ts`
- Create: `src/lib/copilot/runtime/user-home.test.ts`

- [ ] **Step 1.1: Write failing config tests**

Create `src/lib/copilot/runtime/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCopilotRuntimeConfig } from './config';

describe('getCopilotRuntimeConfig', () => {
  it('uses conservative defaults', () => {
    expect(getCopilotRuntimeConfig({}, '/tmp/flight-school')).toEqual({
      idleTtlMs: 600_000,
      maxActiveRuntimes: 3,
      homeRoot: '/tmp/flight-school/copilot-runtimes',
    });
  });

  it('reads env overrides', () => {
    expect(getCopilotRuntimeConfig({
      COPILOT_RUNTIME_IDLE_TTL_MS: '30000',
      COPILOT_RUNTIME_MAX_ACTIVE: '2',
      COPILOT_RUNTIME_HOME_ROOT: '/tmp/custom-runtimes',
    }, '/tmp/flight-school')).toEqual({
      idleTtlMs: 30_000,
      maxActiveRuntimes: 2,
      homeRoot: '/tmp/custom-runtimes',
    });
  });

  it('rejects invalid max active runtimes', () => {
    expect(() => getCopilotRuntimeConfig({ COPILOT_RUNTIME_MAX_ACTIVE: '0' }, '/tmp/root'))
      .toThrow('COPILOT_RUNTIME_MAX_ACTIVE must be a positive integer');
  });
});
```

- [ ] **Step 1.2: Write failing user-home tests**

Create `src/lib/copilot/runtime/user-home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCopilotRuntimeHome } from './user-home';

describe('getCopilotRuntimeHome', () => {
  it('builds a safe per-user home path', () => {
    expect(getCopilotRuntimeHome('/tmp/runtimes', '123')).toBe('/tmp/runtimes/123');
  });

  it('rejects path traversal user IDs', () => {
    expect(() => getCopilotRuntimeHome('/tmp/runtimes', '../123'))
      .toThrow('Refusing unsafe userId for runtime path');
  });
});
```

- [ ] **Step 1.3: Run tests to verify RED**

Run:

```bash
npm test -- --run src/lib/copilot/runtime/config.test.ts src/lib/copilot/runtime/user-home.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 1.4: Implement config and path helpers**

Create:

```ts
export interface CopilotRuntimeConfig {
  idleTtlMs: number;
  maxActiveRuntimes: number;
  homeRoot: string;
}
export function getCopilotRuntimeConfig(env?: Record<string, string | undefined>, storageRoot?: string): CopilotRuntimeConfig;
export function getCopilotRuntimeHome(homeRoot: string, userId: string): string;
```

Implementation notes:
- Defaults: `idleTtlMs=600_000`, `maxActiveRuntimes=3`, `homeRoot=path.join(storageRoot, 'copilot-runtimes')`.
- If no `storageRoot` is passed, use `getStorageRoot()` exported from `src/lib/storage/utils.ts`; add that export by renaming the existing private `getDefaultStorageDir()` to exported `getStorageRoot()`.
- Use `SAFE_USER_ID` from `src/lib/storage/user-scope.ts`; do not import `server-only` into tests by using a small duplicated regex if importing causes test issues.
- Use `safeChildPath(homeRoot, userId)`.

- [ ] **Step 1.5: Run tests to verify GREEN**

Run same command as Step 1.3. Expected: PASS.

- [ ] **Step 1.6: Commit Task 1**

```bash
git add src/lib/copilot/runtime/config.ts src/lib/copilot/runtime/config.test.ts src/lib/copilot/runtime/user-home.ts src/lib/copilot/runtime/user-home.test.ts src/lib/storage/utils.ts
git commit -m "feat: add copilot runtime config paths" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Extract shared chat session execution

**Files:**
- Create: `src/lib/copilot/runtime/session-executor.ts`
- Create: `src/lib/copilot/runtime/session-executor.test.ts`
- Modify: `src/lib/copilot/execution/in-process.ts`

- [ ] **Step 2.1: Write failing session executor tests**

Create `src/lib/copilot/runtime/session-executor.test.ts` that passes fake logged sessions into:

```ts
executeChatWithSessionFactory(request, createChatSession, createGitHubChatSession)
```

Cover:
- lightweight prompts call `createChatSession`;
- `useGitHubTools:true` calls `createGitHubChatSession`;
- `destroy()` is called when send fails.

- [ ] **Step 2.2: Run test to verify RED**

Run: `npm test -- --run src/lib/copilot/runtime/session-executor.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2.3: Implement shared executor**

Create a function:

```ts
export async function executeChatWithSessionFactory(
  request: CopilotChatExecutionRequest,
  createChatSession: SessionFactory,
  createGitHubChatSession: SessionFactory,
): Promise<CopilotChatExecutionResult>
```

Move the body currently in `executeCopilotChatInProcess()` into this function, parameterizing the two session factories.

- [ ] **Step 2.4: Update in-process adapter**

Change `executeCopilotChatInProcess()` to call `executeChatWithSessionFactory()` with `createLoggedChatSession` and `createLoggedGitHubChatSession`.

- [ ] **Step 2.5: Run focused tests**

Run:

```bash
npm test -- --run src/lib/copilot/runtime/session-executor.test.ts src/lib/copilot/execution/in-process.test.ts
```

Expected: PASS.

- [ ] **Step 2.6: Commit Task 2**

```bash
git add src/lib/copilot/runtime/session-executor.ts src/lib/copilot/runtime/session-executor.test.ts src/lib/copilot/execution/in-process.ts src/lib/copilot/execution/in-process.test.ts
git commit -m "refactor: share copilot chat session execution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add SDK-backed per-user runtime

**Files:**
- Modify: `src/lib/copilot/runtime/types.ts`
- Create: `src/lib/copilot/runtime/user-runtime.ts`
- Create: `src/lib/copilot/runtime/user-runtime.test.ts`

- [ ] **Step 3.1: Write failing runtime tests**

Mock `@github/copilot-sdk` and verify:
- creating runtime for user `123` constructs `CopilotClient` with `{ gitHubToken, useLoggedInUser:false, copilotHome }`;
- different users get different homes;
- `disconnect()` calls `client.stop()`;
- if `stop()` returns errors, `forceStop()` is called.

- [ ] **Step 3.2: Run test to verify RED**

Run: `npm test -- --run src/lib/copilot/runtime/user-runtime.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3.3: Extend runtime types**

Update runtime types:

```ts
export interface CopilotRuntimeCreationContext {
  gitHubToken: string;
}

export interface CopilotRuntime {
  userId: string;
  copilotHome: string;
  executeChat: (request: CopilotChatExecutionRequest) => Promise<CopilotChatExecutionResult>;
  disconnect: () => Promise<void> | void;
}

export interface CopilotRuntimePool {
  getRuntime: (userId: string, context: CopilotRuntimeCreationContext) => Promise<CopilotRuntime>;
  evictRuntime: (userId: string) => Promise<void>;
  shutdown: () => Promise<void>;
}

export interface CreatePerUserRuntimePoolOptions {
  createRuntime: (userId: string, context: CopilotRuntimeCreationContext) => Promise<CopilotRuntime>;
  idleTtlMs: number;
  maxActiveRuntimes: number;
  now?: () => number;
  onEvent?: (event: CopilotRuntimeLifecycleEvent) => void;
}
```

- [ ] **Step 3.4: Implement user runtime factory**

Create:

```ts
export interface CreateCopilotUserRuntimeOptions {
  userId: string;
  gitHubToken: string;
  copilotHome: string;
}
export async function createCopilotUserRuntime(options: CreateCopilotUserRuntimeOptions): Promise<CopilotRuntime>;
```

Implementation notes:
- Construct `new CopilotClient({ gitHubToken, useLoggedInUser:false, copilotHome })`.
- Create session factory functions that use this client and `wrapSessionWithLogging`.
- Use the same prompts, models, MCP tools, and permission handler behavior as `server.ts` / `sessions.ts`.
- If this creates too much duplication, extract small shared helpers from `sessions.ts` such as `createCopilotSessionConfig()`.
- Do not log `gitHubToken`.

- [ ] **Step 3.5: Run runtime tests**

Run: `npm test -- --run src/lib/copilot/runtime/user-runtime.test.ts src/lib/copilot/runtime/per-user-pool.test.ts`

Expected: PASS.

- [ ] **Step 3.6: Commit Task 3**

```bash
git add src/lib/copilot/runtime/types.ts src/lib/copilot/runtime/user-runtime.ts src/lib/copilot/runtime/user-runtime.test.ts src/lib/copilot/runtime/per-user-pool.test.ts src/lib/copilot/sessions.ts src/lib/copilot/server.ts
git commit -m "feat: add sdk-backed per-user copilot runtime" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Wire runtime pool into worker execution

**Files:**
- Create: `src/lib/copilot/runtime/worker-executor.ts`
- Create: `src/lib/copilot/runtime/worker-executor.test.ts`
- Modify: `src/app/api/_internal/copilot/execute/route.ts`
- Modify: `src/app/api/_internal/copilot/execute/route.test.ts`

- [ ] **Step 4.1: Write failing worker executor tests**

Test that `executeCopilotChatInWorkerRuntime(request)`:
- creates a runtime using request `identity.userId` and `identity.gitHubToken`;
- reuses the runtime for the same user;
- creates a second runtime for a different user;
- returns `runtime.executeChat(request)`.

- [ ] **Step 4.2: Run test to verify RED**

Run: `npm test -- --run src/lib/copilot/runtime/worker-executor.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 4.3: Implement worker executor**

Create a module-global pool:

```ts
const pool = createPerUserRuntimePool({
  createRuntime: (userId, context) => createCopilotUserRuntime({
    userId,
    gitHubToken: context.gitHubToken,
    copilotHome: getCopilotRuntimeHome(config.homeRoot, userId),
  }),
  idleTtlMs: config.idleTtlMs,
  maxActiveRuntimes: config.maxActiveRuntimes,
});
```

Call `pool.getRuntime(request.identity.userId, { gitHubToken: request.identity.gitHubToken })`; do not store tokens in maps or logs.

- [ ] **Step 4.4: Update worker route**

Replace `executeCopilotChatInProcess(workerRequest)` with `executeCopilotChatInWorkerRuntime(workerRequest)`.

Update tests to mock `@/lib/copilot/runtime/worker-executor`.

- [ ] **Step 4.5: Run focused route/runtime tests**

Run:

```bash
npm test -- --run src/lib/copilot/runtime/worker-executor.test.ts src/app/api/_internal/copilot/execute/route.test.ts src/lib/copilot/runtime/per-user-pool.test.ts
```

Expected: PASS.

- [ ] **Step 4.6: Commit Task 4**

```bash
git add src/lib/copilot/runtime src/app/api/_internal/copilot/execute/route.ts src/app/api/_internal/copilot/execute/route.test.ts
git commit -m "feat: route worker chat through per-user runtime pool" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture-multitenant.md`
- Modify: `docs/superpowers/specs/2026-05-22-local-per-user-copilot-runtime-design.md`

- [ ] **Step 5.1: Update docs**

Document:
- local worker mode creates one SDK-spawned CLI process per user;
- runtime homes live under `FLIGHT_SCHOOL_DATA_DIR/copilot-runtimes/{userId}` by default;
- `COPILOT_RUNTIME_IDLE_TTL_MS`, `COPILOT_RUNTIME_MAX_ACTIVE`, and `COPILOT_RUNTIME_HOME_ROOT`;
- installed SDK does not support `cliUrl + gitHubToken`, so external runtime servers remain deferred.

- [ ] **Step 5.2: Mark spec status**

Set spec status to `Foundation Implemented`.

- [ ] **Step 5.3: Run final gate**

Run:

```bash
npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check && npm run aspire:build && az bicep build --file infra/main.bicep --stdout >/dev/null && git --no-pager status --short
```

Expected: exit 0 and clean working tree.

- [ ] **Step 5.4: Commit docs**

```bash
git add README.md docs/architecture-multitenant.md docs/superpowers/specs/2026-05-22-local-per-user-copilot-runtime-design.md
git commit -m "docs: document local per-user copilot runtimes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Verification Commands Summary
| Step | Command | Expected |
|---|---|---|
| 1.3 | `npm test -- --run src/lib/copilot/runtime/config.test.ts src/lib/copilot/runtime/user-home.test.ts` | FAIL before modules |
| 1.5 | Same as 1.3 | PASS |
| 2.2 | `npm test -- --run src/lib/copilot/runtime/session-executor.test.ts` | FAIL before module |
| 2.5 | `npm test -- --run src/lib/copilot/runtime/session-executor.test.ts src/lib/copilot/execution/in-process.test.ts` | PASS |
| 3.2 | `npm test -- --run src/lib/copilot/runtime/user-runtime.test.ts` | FAIL before module |
| 3.5 | `npm test -- --run src/lib/copilot/runtime/user-runtime.test.ts src/lib/copilot/runtime/per-user-pool.test.ts` | PASS |
| 4.2 | `npm test -- --run src/lib/copilot/runtime/worker-executor.test.ts` | FAIL before module |
| 4.5 | `npm test -- --run src/lib/copilot/runtime/worker-executor.test.ts src/app/api/_internal/copilot/execute/route.test.ts src/lib/copilot/runtime/per-user-pool.test.ts` | PASS |
| 5.3 | Full final gate command | PASS |

## Rollback Plan
| Task | Rollback |
|---|---|
| Task 1 | Revert commit `feat: add copilot runtime config paths`. |
| Task 2 | Revert commit `refactor: share copilot chat session execution`. |
| Task 3 | Revert commit `feat: add sdk-backed per-user copilot runtime`. |
| Task 4 | Revert commit `feat: route worker chat through per-user runtime pool`. |
| Task 5 | Revert commit `docs: document local per-user copilot runtimes`. |

## Specialist Sign-Off
| Specialist | Status | Notes |
|---|---|---|
| Architecture | approve with caution | Pool context extension must be simple and type-safe. |
| Security | approve | Path sanitization and no token logs are required. |
| Operations | approve with caution | Low defaults reduce local runaway child-process risk. |

## Execution Handoff
- **Start At**: Task 1.
- **Recommended Mode**: Inline execution with focused commits.
- **Final Verification**: Task 5.3.
