# Mandatory Copilot Worker Implementation Plan

**Status:** ✅ Implemented. `executeCopilotChat()` throws `CopilotWorkerRequiredError` when `COPILOT_WORKER_URL` is unset; the public in-process fallback is gone. The in-process adapter file is scheduled for deletion in the architecture-cleanup plan (Phase 1).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the public in-process Copilot fallback so public AI chat requires the worker boundary.

**Architecture:** `executeCopilotChat()` becomes worker-only and throws a typed configuration error when `COPILOT_WORKER_URL` is missing. The worker-internal runtime/session helpers remain available for `/api/internal/copilot/execute`, while local scripts and docs make Aspire/web+worker mode the default path.

**Tech Stack:** Next.js App Router API routes, TypeScript, Vitest, npm scripts, existing Copilot worker HTTP client.

---

## Resumption Section
- **Scope**: Implements `docs/superpowers/specs/2026-05-22-mandatory-copilot-worker-design.md`.
- **Current Phase**: Plan ready for execution.
- **Next Action**: Execute Task 1 with TDD.
- **Blockers**: None.

## From Spec
- **Stories**: S1 worker required for public chat, S2 safe local commands, S3 fallback regression tests/docs.
- **Migration Strategy**: Fail-forward; no env override for public in-process execution.
- **Key decision**: Keep `executeCopilotChatInProcess()` for worker/internal tests but never call it from public selector fallback.

## Codebase Analysis
| # | File | Role | Change |
|---|---|---|---|
| F1 | `src/lib/copilot/execution/worker-required-error.ts` | Typed error | Add safe config error for missing worker. |
| F2 | `src/lib/copilot/execution/index.ts` | Public selector | Throw when worker config is missing; never call in-process fallback. |
| F3 | `src/lib/copilot/execution/index.test.ts` | Regression tests | Prove missing worker throws and in-process helper is not called. |
| F4 | `src/app/api/copilot/route.test.ts` | Route test | Prove missing worker error is safe and does not call session factories. |
| F5 | `package.json` | Scripts | Make `dev` run Aspire, add `dev:web-only`, keep manual worker commands. |
| F6 | `.env.example`, `README.md`, `docs/architecture-multitenant.md` | Docs | Remove optional fallback language. |
| F7 | `docs/superpowers/specs/2026-05-22-mandatory-copilot-worker-design.md` | Spec status | Mark foundation implemented after code/docs. |

## Implementation Steps

### Task 1: Make public Copilot execution worker-only

**Files:**
- Create: `src/lib/copilot/execution/worker-required-error.ts`
- Modify: `src/lib/copilot/execution/index.ts`
- Modify: `src/lib/copilot/execution/index.test.ts`

- [ ] **Step 1.1: Write failing selector tests**

Update `src/lib/copilot/execution/index.test.ts`:

```ts
it('throws a safe configuration error when no worker is configured', async () => {
  mocks.getCopilotWorkerConfig.mockReturnValue(null);

  await expect(executeCopilotChat(request)).rejects.toThrow('Copilot worker is required for chat execution');

  expect(mocks.executeCopilotChatInProcess).not.toHaveBeenCalled();
  expect(mocks.executeCopilotChatViaWorker).not.toHaveBeenCalled();
});
```

Remove the old test named `uses in-process execution when no worker is configured`.

- [ ] **Step 1.2: Run selector test to verify RED**

Run: `npm test -- --run src/lib/copilot/execution/index.test.ts`

Expected: FAIL because `executeCopilotChat()` still uses the in-process fallback.

- [ ] **Step 1.3: Add typed worker-required error**

Create `src/lib/copilot/execution/worker-required-error.ts`:

```ts
export class CopilotWorkerRequiredError extends Error {
  constructor() {
    super('Copilot worker is required for chat execution. Start the app with npm run aspire:run or configure COPILOT_WORKER_URL.');
    this.name = 'CopilotWorkerRequiredError';
  }
}
```

- [ ] **Step 1.4: Remove fallback from selector**

Update `src/lib/copilot/execution/index.ts`:

```ts
import { getCopilotWorkerConfig } from './config';
import { executeCopilotChatViaWorker } from './http-client';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';
import { CopilotWorkerRequiredError } from './worker-required-error';

export async function executeCopilotChat(request: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult> {
  const workerConfig = getCopilotWorkerConfig();
  if (!workerConfig) {
    throw new CopilotWorkerRequiredError();
  }
  return executeCopilotChatViaWorker(workerConfig, request);
}
```

- [ ] **Step 1.5: Run selector tests**

Run: `npm test -- --run src/lib/copilot/execution/index.test.ts`

Expected: PASS.

- [ ] **Step 1.6: Commit Task 1**

```bash
git add src/lib/copilot/execution/index.ts src/lib/copilot/execution/index.test.ts src/lib/copilot/execution/worker-required-error.ts
git commit -m "feat: require copilot worker for chat execution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Surface safe route error

**Files:**
- Modify: `src/app/api/copilot/route.test.ts`
- Modify: `src/lib/security/http.ts`

- [ ] **Step 2.1: Write failing route test**

Update `src/app/api/copilot/route.test.ts`:

```ts
it('returns a safe configuration error when the worker is not configured', async () => {
  mocks.executeCopilotChat.mockRejectedValue(new CopilotWorkerRequiredError());

  const response = await POST(makeRequest({ prompt: 'hello with ghu_user token text' }));
  const text = await response.text();

  expect(response.status).toBe(500);
  expect(text).toContain('Copilot worker is required for chat execution');
  expect(text).not.toContain('ghu_user');
  expect(mocks.createLoggedChatSession).not.toHaveBeenCalled();
  expect(mocks.createLoggedGitHubChatSession).not.toHaveBeenCalled();
});
```

Mock/import `CopilotWorkerRequiredError` from `@/lib/copilot/execution/worker-required-error`.

- [ ] **Step 2.2: Run route test to verify behavior**

Run: `npm test -- --run src/app/api/copilot/route.test.ts`

Expected: PASS if existing generic route handling is already safe; if it fails, proceed to Step 2.3.

- [ ] **Step 2.3: Add explicit guard response if needed**

If Step 2.2 fails because the error is not mapped safely, update `src/lib/security/http.ts`:

```ts
import { CopilotWorkerRequiredError } from '@/lib/copilot/execution/worker-required-error';

if (error instanceof CopilotWorkerRequiredError) {
  return NextResponse.json({ error: error.message, code: 'copilot_worker_required' }, { status: 500 });
}
```

- [ ] **Step 2.4: Run route/security tests**

Run:

```bash
npm test -- --run src/app/api/copilot/route.test.ts src/lib/security/guard.test.ts
```

Expected: PASS.

- [ ] **Step 2.5: Commit Task 2**

```bash
git add src/app/api/copilot/route.test.ts src/lib/security/http.ts
git commit -m "test: cover missing copilot worker route error" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Make local scripts fail forward

**Files:**
- Modify: `package.json`

- [ ] **Step 3.1: Update scripts**

Change scripts:

```json
"dev": "npm run aspire:run",
"dev:web-only": "next dev",
"dev:worker": "next dev --port 3001",
"dev:web-worker": "COPILOT_WORKER_URL=http://localhost:3001 COPILOT_WORKER_SECRET=local-dev-worker-secret npm run dev:web-only"
```

Keep `aspire:run` unchanged.

- [ ] **Step 3.2: Validate package JSON**

Run:

```bash
node -e "const p=require('./package.json'); if (p.scripts.dev !== 'npm run aspire:run') process.exit(1); if (!p.scripts['dev:web-only']) process.exit(1)"
```

Expected: exit 0.

- [ ] **Step 3.3: Commit Task 3**

```bash
git add package.json
git commit -m "chore: make worker mode the default dev path" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Update docs and env comments

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/architecture-multitenant.md`
- Modify: `docs/superpowers/specs/2026-05-22-mandatory-copilot-worker-design.md`

- [ ] **Step 4.1: Update env comments**

In `.env.example`, replace optional fallback language with:

```bash
# Copilot worker boundary (required for AI chat routes).
# Public /api/copilot fails fast when COPILOT_WORKER_URL is unset.
# COPILOT_WORKER_URL=http://localhost:3001
```

- [ ] **Step 4.2: Update README commands**

Document:
- `npm run dev` starts Aspire web + worker.
- `npm run dev:web-only` is UI-only and Copilot routes fail without `COPILOT_WORKER_URL`.
- manual two-terminal mode still works with `dev:worker` + `dev:web-worker`.

- [ ] **Step 4.3: Update architecture docs**

Replace “in-process fallback” language with “worker required for public chat”. Keep the note that the in-process helper exists only inside worker/test internals.

- [ ] **Step 4.4: Mark spec status**

Set `docs/superpowers/specs/2026-05-22-mandatory-copilot-worker-design.md` status to `Foundation Implemented`.

- [ ] **Step 4.5: Check docs diff**

Run: `git --no-pager diff --check`

Expected: PASS.

- [ ] **Step 4.6: Commit Task 4**

```bash
git add .env.example README.md docs/architecture-multitenant.md docs/superpowers/specs/2026-05-22-mandatory-copilot-worker-design.md
git commit -m "docs: make copilot worker mandatory" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Final verification

**Files:**
- No new files.

- [ ] **Step 5.1: Run full gate**

Run:

```bash
npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check && npm run aspire:build && az bicep build --file infra/main.bicep --stdout >/dev/null && git --no-pager status --short
```

Expected: exit 0 and clean working tree.

## Verification Commands Summary
| Step | Command | Expected |
|---|---|---|
| 1.2 | `npm test -- --run src/lib/copilot/execution/index.test.ts` | FAIL before selector change |
| 1.5 | Same as 1.2 | PASS |
| 2.2 | `npm test -- --run src/app/api/copilot/route.test.ts` | PASS or identifies explicit mapping need |
| 2.4 | `npm test -- --run src/app/api/copilot/route.test.ts src/lib/security/guard.test.ts` | PASS |
| 3.2 | `node -e "const p=require('./package.json'); if (p.scripts.dev !== 'npm run aspire:run') process.exit(1); if (!p.scripts['dev:web-only']) process.exit(1)"` | PASS |
| 4.5 | `git --no-pager diff --check` | PASS |
| 5.1 | Full final gate | PASS |

## Rollback Plan
| Task | Rollback |
|---|---|
| Task 1 | Revert commit `feat: require copilot worker for chat execution`. |
| Task 2 | Revert commit `test: cover missing copilot worker route error`. |
| Task 3 | Revert commit `chore: make worker mode the default dev path`. |
| Task 4 | Revert commit `docs: make copilot worker mandatory`. |

## Specialist Sign-Off
| Specialist | Status | Notes |
|---|---|---|
| Architecture | approve | Public selector no longer violates worker-only architecture. |
| Security | approve | Removes risky public in-process path entirely. |
| Developer Experience | approve | Web-only command keeps UI debugging available but explicit. |

## Execution Handoff
- **Start At**: Task 1.
- **Recommended Mode**: Inline execution; small sequential changes.
- **Final Verification**: Task 5.1.
