# Worker Job Execution Split Implementation Plan

**Status:** ✅ Implemented. Job executors and the per-user session registry live under `src/worker/`; web code under `src/app/` only orchestrates submission, listing, and cancellation. Retained for historical context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move background job execution and cancellation onto the Copilot worker process and make that ownership obvious in the code layout.

**Architecture:** Web/UI/API code remains under `src/app` and only orchestrates job creation, listing, and cancellation. Worker code lives under `src/worker` and owns executors, Copilot sessions, executor storage adapters, and session registry; shared contracts stay under `src/lib/jobs`.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Aspire, existing job storage/executors, Copilot worker HTTP config.

---

## Resumption Section
- **Scope**: Implements `docs/superpowers/specs/2026-05-22-worker-job-execution-split-design.md`.
- **Current Phase**: Plan ready for rubber-duck review.
- **Next Action**: Rubber-duck, then execute Task 1.
- **Blockers**: None.

## Rubber-duck adjustments
- Local dev uses `InMemoryTokenStore`, so web and worker do not share token store state. The worker dispatch request must include short-lived credential seed material; persisted job storage remains token-free.
- Worker dispatch failures must mark the job failed rather than leaving it pending.
- Worker routes should use `COPILOT_WORKER_MODE` consistently, including the existing Copilot execute route.
- Web-side job route modules must stop importing executor/session-registry code.
- Worker execute route must validate job ownership before executing.
- User clarified this must clean up tech debt as it goes: no strays of web-side session execution, no confusing fallbacks, and a visible web/worker/shared code layout.
- Second Opus review: architecture guards must scan all web `src/app/**` files outside internal worker routes; local dispatch credentials must not be unconditional in production; cancellation must handle cancel-before-session-registration.

## File ownership map
| Zone | Paths after this plan | Responsibility |
|---|---|---|
| Web/API | `src/app/api/jobs/**`, excluding `src/app/api/internal/**` | Public job create/list/cancel routes and worker HTTP client only. |
| Worker route adapters | `src/app/api/internal/jobs/**` | Thin authenticated HTTP adapters into worker modules. |
| Worker implementation | `src/worker/jobs/**` | Job executors, worker executor dispatcher, session registry, cancellation, executor storage adapters. |
| Shared contracts | `src/lib/jobs/dispatch.ts`, `src/lib/jobs/**` | DTOs and primitives used by both web and worker. |

## Implementation Steps

### Task 1: Commit prerequisite local/auth stability fixes

**Files:**
- Existing dirty files from smoke debugging.

- [ ] **Step 1.1: Verify focused auth/startup tests**

Run:

```bash
npm test -- --run src/test/architecture/apphost-runner.test.ts src/test/architecture/apphost-scripts.test.ts src/middleware.test.ts src/lib/api-client.test.ts src/app/api/profile/route.test.ts
```

Expected: PASS.

- [ ] **Step 1.2: Commit AppHost startup fixes**

```bash
git add .gitignore apphost.ts knip.json next.config.ts package.json package-lock.json tsconfig.json src/test/architecture/apphost-runner.test.ts src/test/architecture/apphost-scripts.test.ts
git commit -m "fix: stabilize local worker startup" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 1.3: Commit auth/routing fixes**

```bash
git add src/middleware.ts src/middleware.test.ts src/lib/api-client.ts src/lib/api-client.test.ts src/app/api/profile/route.ts src/app/api/profile/route.test.ts
git commit -m "fix: redirect stale auth and isolate worker routes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add shared job dispatch contract and worker client

**Files:**
- Create: `src/lib/jobs/dispatch.ts`
- Create: `src/app/api/jobs/worker-client.ts`
- Create: `src/app/api/jobs/worker-client.test.ts`

- [ ] **Step 2.1: Write failing worker-client tests**

Test `dispatchJobExecutionToWorker(request)` posts to `${COPILOT_WORKER_URL}/api/internal/jobs/execute` with bearer auth and JSON body. The request contains a token-free persisted job descriptor plus trusted dispatch-only credentials only when local/dev credential seeding is enabled:

```ts
{
  jobId,
  type,
  input,
  userId,
  credentials: { accessToken, refreshToken, expiresAt }
}
```

Test non-2xx throws a safe error that does not echo credential values. Also test that production mode omits `credentials` unless `COPILOT_WORKER_DISPATCH_CREDENTIALS=1`.

- [ ] **Step 2.2: Implement shared contract and client**

Move `DispatchableJobType`, `DispatchableJobInput`, and `DispatchJobExecutionRequest` from `dispatcher.ts` to `src/lib/jobs/dispatch.ts`. Add:

```ts
export interface WorkerDispatchCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface DispatchJobExecutionToWorkerRequest extends DispatchJobExecutionRequest {
  credentials: WorkerDispatchCredentials;
}
```

Implement `dispatchJobExecutionToWorker(request)` using `getCopilotWorkerConfig()`.

Add `buildWorkerDispatchCredentials()` in `src/lib/auth/seed.ts` or a sibling server-only helper that returns `{ accessToken, refreshToken, expiresAt } | null` from `readCredentialsFromJwt()`. The web route includes credentials only when `process.env.NODE_ENV !== 'production'` or `COPILOT_WORKER_DISPATCH_CREDENTIALS === '1'`.

- [ ] **Step 2.3: Verify**

Run:

```bash
npm test -- --run src/app/api/jobs/worker-client.test.ts
```

Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add src/lib/jobs/dispatch.ts src/app/api/jobs/worker-client.ts src/app/api/jobs/worker-client.test.ts
git commit -m "feat: add worker job dispatch client" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Move executor implementation into `src/worker/jobs`

**Files:**
- Move: `src/app/api/jobs/executors/*` -> `src/worker/jobs/executors/*`
- Move: `src/app/api/jobs/threads-storage.ts` -> `src/worker/jobs/storage/threads-storage.ts`
- Move: `src/app/api/jobs/evaluation-storage.ts` -> `src/worker/jobs/storage/evaluation-storage.ts`
- Move/replace: `src/app/api/jobs/job-executors.ts` -> `src/worker/jobs/executor-dispatcher.ts`
- Move tests for executor modules alongside the new worker paths.

- [ ] **Step 3.1: Move files with import repair only**

Move files without behavior changes. Update relative imports:
- `../threads-storage` -> `../storage/threads-storage`
- `../evaluation-storage` -> `../storage/evaluation-storage`
- imports from `./executors/*` in the dispatcher barrel -> imports from `./executors/*` under `src/worker/jobs`.

- [ ] **Step 3.2: Add worker executor dispatcher**

Create `src/worker/jobs/executor-dispatcher.ts` exporting:

```ts
export async function executeWorkerJob(request: DispatchJobExecutionRequest): Promise<void>;
export { getRegisteredSession, registerSession, unregisterSession } from './executors/session-registry';
```

`executeWorkerJob()` contains the current job-type switch that calls the moved executors.

- [ ] **Step 3.3: Verify moved executor tests**

Run:

```bash
npm test -- --run src/worker/jobs/executors/session-registry.test.ts src/worker/jobs/executor-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 3.4: Commit**

```bash
git add src/worker/jobs src/app/api/jobs
git commit -m "refactor: move job executors into worker service" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add worker-internal job execute and cancel routes

**Files:**
- Create: `src/app/api/internal/jobs/execute/executor.ts`
- Create: `src/app/api/internal/jobs/execute/route.ts`
- Create: `src/app/api/internal/jobs/execute/route.test.ts`
- Create: `src/app/api/internal/jobs/cancel/route.ts`
- Create: `src/app/api/internal/jobs/cancel/route.test.ts`

- [ ] **Step 4.1: Write failing route tests**

Execute route tests:
- 404 when `COPILOT_WORKER_MODE !== '1'`;
- 401 without bearer;
- 404 when `jobStorage.get(jobId)?.userId !== request.userId`;
- seeds worker `TokenStore` with full `credentials` before scheduling execution when credentials are present;
- returns 400 when partial credentials are present;
- marks the job running before returning 202;
- no-ops and returns 202 for replayed jobs that are already terminal or not pending/running;
- 202 with valid request and schedules executor via `setImmediate`;
- body does not echo job input on errors.

Cancel route tests:
- 404 when not worker mode;
- 401 without bearer;
- 200 when no registered session and records cancel intent;
- destroys registered session when present.

- [ ] **Step 4.2: Implement routes**

`execute/route.ts` validates bearer, parses `DispatchJobExecutionToWorkerRequest`, verifies job ownership with `jobStorage.get(jobId)`, seeds worker token store with `getTokenStore().setTokenIfNewer(userId, credentials)` only when full credentials are present, calls `jobStorage.markRunning(jobId)`, schedules `executeWorkerJob()` with `setImmediate`, returns 202.

`cancel/route.ts` validates bearer, parses `{ jobId }`, calls worker-local `requestCancellation(jobId)`, returns `{ cancelled: boolean }`. Update the moved worker session registry so `registerSession(jobId, session)` immediately destroys/unregisters a session when a pending cancellation marker exists.

- [ ] **Step 4.3: Verify**

Run:

```bash
npm test -- --run src/app/api/internal/jobs/execute/route.test.ts src/app/api/internal/jobs/cancel/route.test.ts
```

Expected: PASS.

- [ ] **Step 4.4: Commit**

```bash
git add src/app/api/internal/jobs
git commit -m "feat: add internal worker job routes" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Switch web dispatcher and cancellation to worker

**Files:**
- Modify: `src/app/api/jobs/dispatcher.ts`
- Modify: `src/app/api/jobs/dispatcher.test.ts`
- Modify: `src/app/api/jobs/route.ts`
- Modify: `src/app/api/jobs/route.test.ts`
- Modify: `src/app/api/jobs/[id]/route.ts`

- [ ] **Step 5.1: Write failing dispatcher tests**

Update tests to expect `dispatchJobExecution()` calls `dispatchJobExecutionToWorker(requestWithCredentials)` and never imports/calls job executors. Add a test that worker dispatch failure marks the job failed.

- [ ] **Step 5.2: Implement web dispatcher**

Remove job executor imports from `dispatcher.ts`. Change dispatcher input so the route passes optional credentials from `buildWorkerDispatchCredentials()`. Keep `setImmediate`, but inside it call `dispatchJobExecutionToWorker(request)`. On error, call `jobStorage.markFailed(jobId, 'Worker dispatch failed')`.

- [ ] **Step 5.3: Add worker cancellation client**

Add `cancelWorkerJob(jobId)` beside `worker-client.ts`, call `/api/internal/jobs/cancel`. Update `cancelRunningJob()` to call it after marking storage cancelled. Delete web-side `getRegisteredSession` / `unregisterSession` imports and the local registered-session branch.

- [ ] **Step 5.4: Verify**

Run:

```bash
npm test -- --run src/app/api/jobs/dispatcher.test.ts src/app/api/jobs/route.test.ts src/app/api/jobs/[id]/route.test.ts src/app/api/internal/jobs/execute/route.test.ts src/app/api/internal/jobs/cancel/route.test.ts
```

Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add src/app/api/jobs src/app/api/internal/jobs src/lib/jobs/dispatch.ts
git commit -m "feat: dispatch background jobs to copilot worker" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Add architecture guard and docs

**Files:**
- Create/modify architecture tests.
- Modify `docs/architecture-multitenant.md`, `docs/deployment-aca.md`, and spec status.

- [ ] **Step 6.1: Add architecture guard**

Add architecture tests:
- no file under `src/app/**` except `src/app/api/internal/**` imports `src/worker/**`, `@github/copilot-sdk`, `@/lib/copilot/server`, or `@/lib/copilot/streaming`.
- `src/app/api/jobs/**` must not import `./job-executors` or `./executors/*`.
- `src/app/api/internal/jobs/**` may import `src/worker/jobs/**`.
- `src/worker/jobs/**` must not import public web route modules under `src/app/api/jobs/route.ts` or `src/app/api/jobs/[id]/route.ts`.
- `src/app/api/jobs/dispatcher.ts` must contain `dispatchJobExecutionToWorker`.

- [ ] **Step 6.2: Update docs**

Document web job orchestration versus worker execution. Mark spec `Foundation Implemented`.

- [ ] **Step 6.3: Verify docs/tests**

Run:

```bash
npm test -- --run src/test/architecture
git --no-pager diff --check
```

Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add src/test/architecture docs/architecture-multitenant.md docs/deployment-aca.md docs/superpowers/specs/2026-05-22-worker-job-execution-split-design.md
git commit -m "docs: document worker-owned job execution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Final verification and smoke

- [ ] **Step 7.1: Full verification**

Run:

```bash
npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check && npm run aspire:build && az bicep build --file infra/main.bicep --stdout >/dev/null
```

- [ ] **Step 7.2: Local smoke**

Start `npm run dev`, submit a chat job, and verify Aspire trace/resource logs show job execution and `copilot.session.create` under `copilot-worker`, not `flight-school`. Also verify:

```bash
rg "@/lib/copilot/(server|streaming)|@github/copilot-sdk|src/worker|job-executors|executors/" src/app --glob '!api/internal/**'
```

returns no web-side violations.

## Rollback Plan
Revert commits in reverse order. The prerequisite local/auth stability commit can remain if job-worker dispatch needs rollback.
