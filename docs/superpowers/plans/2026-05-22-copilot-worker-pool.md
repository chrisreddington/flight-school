# Copilot Worker Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Copilot execution behind a stable internal boundary so the web layer can later delegate to a worker service with per-user runtime isolation.

**Architecture:** Start with an in-process adapter that preserves current behavior, then move job dispatch behind a worker-ready protocol. The first implementation does not spawn per-user CLI processes; it creates the seams needed for a future worker service and per-user runtime pool without rewriting route handlers again.

**Tech Stack:** Next.js App Router API routes, TypeScript, Vitest, GitHub Copilot SDK, Auth.js user context, existing token store/job storage, Azure Container Apps target docs.

---

## Resumption Section
- **Scope**: Implementation foundation for `docs/superpowers/specs/2026-05-22-copilot-worker-pool-design.md`.
- **Current Phase**: Plan ready for review/execution.
- **Next Action**: Execute Task 1.
- **Blockers**: None.

## From Spec
- **Stories**: S1 already documented in commit `56bd000`; S2 execution boundary; S3 worker-ready dispatch; S4 runtime-pool target; S5 incremental migration path.
- **Affected Domains**: Test, performance, code quality, technical writing, code documentation.
- **Migration Strategy**: Indirection first, then worker extraction, then per-user runtime isolation.
- **Risk**: External `cliUrl` plus token behavior must be re-verified against the installed SDK before implementing external CLI auth.
- **Rubber-duck adjustments before execution**: Preserve `/api/copilot` `meta.generatedAt`; use `vi.hoisted` for mocks referenced by `vi.mock` factories; remove stale `shared-runtime.ts` references; validate runtime pool capacity; keep jobs route cancellation imports while moving executor routing into the dispatcher.

## Codebase Analysis
| # | File | Role | Change |
|---|------|------|--------|
| F1 | `src/lib/copilot/execution/types.ts` | Shared execution contract | Create request/result types for chat execution. |
| F2 | `src/lib/copilot/execution/in-process.ts` | Current runtime adapter | Create adapter that wraps existing session factories. |
| F3 | `src/lib/copilot/execution/index.ts` | Public boundary | Export factory and types. |
| F4 | `src/lib/copilot/execution/in-process.test.ts` | Unit tests | Characterize current chat adapter behavior. |
| F5 | `src/app/api/copilot/route.ts` | Chat API route | Replace direct SDK session factory calls with execution boundary. |
| F6 | `src/app/api/copilot/route.test.ts` | Route tests | Add/extend tests for response shape and adapter inputs. |
| F7 | `src/app/api/jobs/dispatcher.ts` | Job dispatch boundary | Move `setImmediate` dispatch behind an injectable dispatcher. |
| F8 | `src/app/api/jobs/dispatcher.test.ts` | Dispatcher tests | Verify token-free payload and executor routing. |
| F9 | `src/app/api/jobs/route.ts` | Jobs API route | Use dispatcher boundary instead of direct `setImmediate`. |
| F10 | `src/lib/copilot/runtime/types.ts` | Runtime pool contracts | Create runtime pool interfaces and lifecycle event types. |
| F11 | `src/lib/copilot/runtime/per-user-pool.ts` | Future pool skeleton | Add disabled/prototype pool logic with no route usage. |
| F12 | `src/lib/copilot/runtime/per-user-pool.test.ts` | Runtime pool tests | Verify user-keying, TTL eviction, and lifecycle hooks with fake runtimes. |
| F13 | `docs/architecture-multitenant.md` | Architecture docs | Add links to the new execution boundary and plan status. |
| F14 | `docs/deployment-aca.md` | ACA docs | Add worker-service migration note and non-production caveat. |

## Implementation Steps

### Task 1: Create the Copilot execution boundary

**Files:**
- Create: `src/lib/copilot/execution/types.ts`
- Create: `src/lib/copilot/execution/in-process.ts`
- Create: `src/lib/copilot/execution/index.ts`
- Create: `src/lib/copilot/execution/in-process.test.ts`

- [ ] **Step 1.1: Write failing tests for chat execution inputs**

Create `src/lib/copilot/execution/in-process.test.ts` with tests that mock `createLoggedChatSession`, `createLoggedGitHubChatSession`, and `needsGitHubTools`.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCopilotChat } from './in-process';

const sendAndWait = vi.fn();
const destroy = vi.fn();

vi.mock('@/lib/copilot/server', () => ({
  createLoggedChatSession: vi.fn(async () => ({
    model: 'claude-haiku-4.5',
    sessionMetrics: { createdNew: true, sessionCreateMs: 7, mcpEnabled: false, reusedConversation: false, poolKey: 'chat:lightweight', model: 'claude-haiku-4.5' },
    sendAndWait,
    destroy,
  })),
  createLoggedGitHubChatSession: vi.fn(async () => ({
    model: 'claude-haiku-4.5',
    sessionMetrics: { createdNew: false, sessionCreateMs: 3, mcpEnabled: true, reusedConversation: true, poolKey: 'chat:mcp', model: 'claude-haiku-4.5' },
    sendAndWait,
    destroy,
  })),
}));

describe('executeCopilotChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendAndWait.mockResolvedValue({
      responseText: 'hello',
      totalTimeMs: 42,
      toolCalls: [{ name: 'get_me', args: {}, result: 'ok', startTime: 10, endTime: 15 }],
    });
  });

  it('uses lightweight chat when GitHub tools are not requested', async () => {
    const result = await executeCopilotChat({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Explain closures',
      useGitHubTools: false,
      conversationId: 'thread-1',
    });

    expect(result.response).toBe('hello');
    expect(result.meta.usedGitHubTools).toBe(false);
    expect(result.meta.sessionPoolHit).toBe(false);
  });

  it('uses GitHub chat when GitHub tools are requested', async () => {
    const result = await executeCopilotChat({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'Search my repos',
      useGitHubTools: true,
      conversationId: 'thread-1',
    });

    expect(result.meta.usedGitHubTools).toBe(true);
    expect(result.meta.mcpEnabled).toBe(true);
    expect(result.toolCalls).toEqual([{ name: 'get_me', args: {}, result: 'ok', duration: 5 }]);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npm test -- --run src/lib/copilot/execution/in-process.test.ts`

Expected: FAIL because `src/lib/copilot/execution/in-process.ts` does not exist.

- [ ] **Step 1.3: Add execution types**

Create `src/lib/copilot/execution/types.ts`:

```ts
import type { SessionIdentity } from '@/lib/copilot/session-identity';

export interface CopilotChatExecutionRequest {
  identity: SessionIdentity;
  prompt: string;
  useGitHubTools?: boolean;
  conversationId?: string;
}

export interface CopilotChatExecutionResult {
  response: string;
  toolCalls: Array<{
    name: string;
    args: unknown;
    result: string;
    duration?: number;
  }>;
  meta: {
    model: string;
    toolsUsed: string[];
    totalTimeMs: number;
    usedGitHubTools: boolean;
    sessionCreateMs: number | null;
    sessionPoolHit: boolean | null;
    mcpEnabled: boolean | null;
    sessionReused: boolean | null;
  };
}
```

- [ ] **Step 1.4: Add in-process adapter**

Create `src/lib/copilot/execution/in-process.ts`:

```ts
import { createLoggedChatSession, createLoggedGitHubChatSession } from '@/lib/copilot/server';
import { needsGitHubTools } from '@/lib/utils/content-detection';
import type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';

export async function executeCopilotChat({
  identity,
  prompt,
  useGitHubTools,
  conversationId,
}: CopilotChatExecutionRequest): Promise<CopilotChatExecutionResult> {
  const enableGitHub = useGitHubTools === true || needsGitHubTools(prompt);
  const sessionType = enableGitHub ? 'GitHub Chat' : 'Chat (fast)';
  const loggedSession = enableGitHub
    ? await createLoggedGitHubChatSession(identity, sessionType, prompt, conversationId)
    : await createLoggedChatSession(identity, sessionType, prompt, conversationId);

  try {
    const result = await loggedSession.sendAndWait(prompt);
    return {
      response: result.responseText,
      toolCalls: result.toolCalls.map((toolCall) => ({
        name: toolCall.name,
        args: toolCall.args,
        result: toolCall.result,
        duration: toolCall.endTime ? toolCall.endTime - toolCall.startTime : undefined,
      })),
      meta: {
        model: loggedSession.model,
        toolsUsed: result.toolCalls.map((toolCall) => toolCall.name),
        totalTimeMs: result.totalTimeMs,
        usedGitHubTools: enableGitHub,
        sessionCreateMs: loggedSession.sessionMetrics?.sessionCreateMs ?? null,
        sessionPoolHit: loggedSession.sessionMetrics ? !loggedSession.sessionMetrics.createdNew : null,
        mcpEnabled: loggedSession.sessionMetrics?.mcpEnabled ?? null,
        sessionReused: loggedSession.sessionMetrics?.reusedConversation ?? null,
      },
    };
  } finally {
    loggedSession.destroy();
  }
}
```

- [ ] **Step 1.5: Add boundary exports**

Create `src/lib/copilot/execution/index.ts`:

```ts
export { executeCopilotChat } from './in-process';
export type { CopilotChatExecutionRequest, CopilotChatExecutionResult } from './types';
```

- [ ] **Step 1.6: Run focused tests**

Run: `npm test -- --run src/lib/copilot/execution/in-process.test.ts`

Expected: PASS.

- [ ] **Step 1.7: Commit Task 1**

```bash
git add src/lib/copilot/execution
git commit -m "refactor: add copilot execution boundary" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Migrate chat route to the execution boundary

**Files:**
- Modify: `src/app/api/copilot/route.ts`
- Test: `src/app/api/copilot/route.test.ts`

- [ ] **Step 2.1: Find or create route tests**

Run: `test -f src/app/api/copilot/route.test.ts && echo exists || echo missing`

Expected: either `exists` or `missing`. If missing, create the file in Step 2.2.

- [ ] **Step 2.2: Add route test for adapter call**

Create or extend `src/app/api/copilot/route.test.ts` with:

```ts
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const executeCopilotChat = vi.fn();

vi.mock('@/lib/security/guard', () => ({
  withUserGuards: vi.fn(async (_opts, work) => work({ userId: '123', login: 'octo', accessToken: 'ghu_user' })),
}));

vi.mock('@/lib/copilot/execution', () => ({
  executeCopilotChat,
}));

describe('/api/copilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeCopilotChat.mockResolvedValue({
      response: 'answer',
      toolCalls: [],
      meta: {
        model: 'claude-haiku-4.5',
        toolsUsed: [],
        totalTimeMs: 12,
        usedGitHubTools: false,
        sessionCreateMs: 4,
        sessionPoolHit: false,
        mcpEnabled: false,
        sessionReused: false,
      },
    });
  });

  it('delegates chat execution through the Copilot execution boundary', async () => {
    const request = new NextRequest('http://localhost/api/copilot', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'hello', useGitHubTools: false, conversationId: 'thread-1' }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.response).toBe('answer');
    expect(executeCopilotChat).toHaveBeenCalledWith({
      identity: { userId: '123', gitHubToken: 'ghu_user' },
      prompt: 'hello',
      useGitHubTools: false,
      conversationId: 'thread-1',
    });
  });
});
```

- [ ] **Step 2.3: Run test to verify it fails against current route**

Run: `npm test -- --run src/app/api/copilot/route.test.ts`

Expected: FAIL because the route still imports direct session factories.

- [ ] **Step 2.4: Update route imports**

In `src/app/api/copilot/route.ts`, replace:

```ts
import { now, nowMs } from '@/lib/utils/date-utils';
import { createLoggedChatSession, createLoggedGitHubChatSession, createSessionIdentity } from '@/lib/copilot/server';
import { needsGitHubTools } from '@/lib/utils/content-detection';
```

with:

```ts
import { nowMs } from '@/lib/utils/date-utils';
import { createSessionIdentity } from '@/lib/copilot/server';
import { executeCopilotChat } from '@/lib/copilot/execution';
```

- [ ] **Step 2.5: Replace direct session execution**

In the guarded callback, replace direct `createLogged*Session` and `sendAndWait` logic with:

```ts
const identity = createSessionIdentity(ctx);
const result = await executeCopilotChat({
  identity,
  prompt,
  useGitHubTools,
  conversationId,
});

const totalTime = nowMs() - startTime;
log.info(`Total: ${totalTime}ms`);

return NextResponse.json(result);
```

- [ ] **Step 2.6: Run focused tests**

Run: `npm test -- --run src/app/api/copilot/route.test.ts src/lib/copilot/execution/in-process.test.ts`

Expected: PASS.

- [ ] **Step 2.7: Commit Task 2**

```bash
git add src/app/api/copilot/route.ts src/app/api/copilot/route.test.ts src/lib/copilot/execution
git commit -m "refactor: route copilot chat through execution boundary" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Add worker-ready job dispatcher boundary

**Files:**
- Create: `src/app/api/jobs/dispatcher.ts`
- Create: `src/app/api/jobs/dispatcher.test.ts`
- Modify: `src/app/api/jobs/route.ts`

- [ ] **Step 3.1: Write dispatcher tests**

Create `src/app/api/jobs/dispatcher.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchJobExecution } from './dispatcher';

const executeTopicRegeneration = vi.fn();

vi.mock('./job-executors', () => ({
  executeTopicRegeneration: (...args: unknown[]) => executeTopicRegeneration(...args),
  executeChallengeRegeneration: vi.fn(),
  executeGoalRegeneration: vi.fn(),
  executeChatResponse: vi.fn(),
  executeChallengeEvaluation: vi.fn(),
}));

describe('dispatchJobExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeTopicRegeneration.mockResolvedValue(undefined);
  });

  it('dispatches token-free job payloads by type', async () => {
    const scheduled = dispatchJobExecution({
      jobId: 'job-1',
      type: 'topic-regeneration',
      input: { topicId: 'topic-1' },
      userId: '123',
    });

    await scheduled;

    expect(executeTopicRegeneration).toHaveBeenCalledWith('job-1', { topicId: 'topic-1' }, '123');
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npm test -- --run src/app/api/jobs/dispatcher.test.ts`

Expected: FAIL because `dispatcher.ts` does not exist.

- [ ] **Step 3.3: Add dispatcher module**

Create `src/app/api/jobs/dispatcher.ts`:

```ts
import type {
  ChallengeEvaluationInput,
  ChallengeRegenerationInput,
  ChatResponseInput,
  GoalRegenerationInput,
  TopicRegenerationInput,
} from '@/lib/jobs';
import { logger } from '@/lib/logger';
import {
  executeChallengeEvaluation,
  executeChallengeRegeneration,
  executeChatResponse,
  executeGoalRegeneration,
  executeTopicRegeneration,
} from './job-executors';

const log = logger.withTag('Job Dispatcher');

export type DispatchableJobType =
  | 'topic-regeneration'
  | 'challenge-regeneration'
  | 'goal-regeneration'
  | 'chat-response'
  | 'challenge-evaluation';

export type DispatchableJobInput =
  | TopicRegenerationInput
  | ChallengeRegenerationInput
  | GoalRegenerationInput
  | ChatResponseInput
  | ChallengeEvaluationInput;

export interface DispatchJobExecutionRequest {
  jobId: string;
  type: DispatchableJobType;
  input: DispatchableJobInput;
  userId: string;
}

export async function executeDispatchedJob({
  jobId,
  type,
  input,
  userId,
}: DispatchJobExecutionRequest): Promise<void> {
  if (type === 'topic-regeneration') return executeTopicRegeneration(jobId, input as TopicRegenerationInput, userId);
  if (type === 'challenge-regeneration') return executeChallengeRegeneration(jobId, input as ChallengeRegenerationInput, userId);
  if (type === 'goal-regeneration') return executeGoalRegeneration(jobId, input as GoalRegenerationInput, userId);
  if (type === 'chat-response') return executeChatResponse(jobId, input as ChatResponseInput, userId);
  return executeChallengeEvaluation(jobId, input as ChallengeEvaluationInput, userId);
}

export function dispatchJobExecution(request: DispatchJobExecutionRequest): Promise<void> {
  const scheduled = new Promise<void>((resolve) => {
    setImmediate(() => {
      executeDispatchedJob(request)
        .then(resolve)
        .catch((err: unknown) => {
          log.error(`Unhandled error in job ${request.jobId}:`, err);
          resolve();
        });
    });
  });
  return scheduled;
}
```

- [ ] **Step 3.4: Update jobs route to use dispatcher**

In `src/app/api/jobs/route.ts`, remove `executeByType` and `enqueueExecution`, import:

```ts
import { dispatchJobExecution, type DispatchableJobInput, type DispatchableJobType } from './dispatcher';
```

Then change `JobType` to:

```ts
type JobType = DispatchableJobType;
```

And replace the enqueue call with:

```ts
dispatchJobExecution({
  jobId,
  type: body.type,
  input: body.input as DispatchableJobInput,
  userId,
});
```

- [ ] **Step 3.5: Run focused job tests**

Run: `npm test -- --run src/app/api/jobs/dispatcher.test.ts src/app/api/jobs/route.test.ts`

Expected: PASS.

- [ ] **Step 3.6: Commit Task 3**

```bash
git add src/app/api/jobs/dispatcher.ts src/app/api/jobs/dispatcher.test.ts src/app/api/jobs/route.ts
git commit -m "refactor: add worker-ready job dispatcher" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Add runtime pool contracts and fake-tested per-user pool

**Files:**
- Create: `src/lib/copilot/runtime/types.ts`
- Create: `src/lib/copilot/runtime/per-user-pool.ts`
- Create: `src/lib/copilot/runtime/index.ts`
- Create: `src/lib/copilot/runtime/per-user-pool.test.ts`

- [ ] **Step 4.1: Write fake runtime pool tests**

Create `src/lib/copilot/runtime/per-user-pool.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPerUserRuntimePool } from './per-user-pool';

describe('createPerUserRuntimePool', () => {
  it('reuses a runtime for the same user', async () => {
    const disconnect = vi.fn();
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect }));
    const pool = createPerUserRuntimePool({ createRuntime, idleTtlMs: 60_000, maxActiveRuntimes: 2 });

    const first = await pool.getRuntime('123');
    const second = await pool.getRuntime('123');

    expect(first).toBe(second);
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });

  it('evicts the least recently used runtime when capacity is exceeded', async () => {
    const disconnect = vi.fn();
    const createRuntime = vi.fn(async (userId: string) => ({ userId, disconnect }));
    const pool = createPerUserRuntimePool({ createRuntime, idleTtlMs: 60_000, maxActiveRuntimes: 1 });

    await pool.getRuntime('123');
    await pool.getRuntime('456');

    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(createRuntime).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npm test -- --run src/lib/copilot/runtime/per-user-pool.test.ts`

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 4.3: Add runtime types**

Create `src/lib/copilot/runtime/types.ts`:

```ts
export interface CopilotRuntime {
  userId: string;
  disconnect: () => Promise<void> | void;
}

export interface CopilotRuntimePool {
  getRuntime: (userId: string) => Promise<CopilotRuntime>;
  evictRuntime: (userId: string) => Promise<void>;
  shutdown: () => Promise<void>;
}

export interface CreatePerUserRuntimePoolOptions {
  createRuntime: (userId: string) => Promise<CopilotRuntime>;
  idleTtlMs: number;
  maxActiveRuntimes: number;
}
```

- [ ] **Step 4.4: Add per-user pool**

Create `src/lib/copilot/runtime/per-user-pool.ts`:

```ts
import type { CopilotRuntime, CopilotRuntimePool, CreatePerUserRuntimePoolOptions } from './types';

interface RuntimeEntry {
  runtime: CopilotRuntime;
  lastUsed: number;
}

export function createPerUserRuntimePool({
  createRuntime,
  idleTtlMs,
  maxActiveRuntimes,
}: CreatePerUserRuntimePoolOptions): CopilotRuntimePool {
  const runtimes = new Map<string, RuntimeEntry>();

  async function disconnectEntry(userId: string, entry: RuntimeEntry): Promise<void> {
    runtimes.delete(userId);
    await entry.runtime.disconnect();
  }

  async function pruneExpired(now: number): Promise<void> {
    for (const [userId, entry] of runtimes.entries()) {
      if (now - entry.lastUsed > idleTtlMs) {
        await disconnectEntry(userId, entry);
      }
    }
  }

  async function pruneOverflow(): Promise<void> {
    while (runtimes.size > maxActiveRuntimes) {
      const oldest = [...runtimes.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (!oldest) return;
      await disconnectEntry(oldest[0], oldest[1]);
    }
  }

  return {
    async getRuntime(userId: string) {
      const now = Date.now();
      await pruneExpired(now);
      const existing = runtimes.get(userId);
      if (existing) {
        existing.lastUsed = now;
        return existing.runtime;
      }

      const runtime = await createRuntime(userId);
      runtimes.set(userId, { runtime, lastUsed: now });
      await pruneOverflow();
      return runtime;
    },
    async evictRuntime(userId: string) {
      const entry = runtimes.get(userId);
      if (entry) await disconnectEntry(userId, entry);
    },
    async shutdown() {
      const entries = [...runtimes.entries()];
      await Promise.all(entries.map(([userId, entry]) => disconnectEntry(userId, entry)));
    },
  };
}
```

- [ ] **Step 4.5: Add runtime exports**

Create `src/lib/copilot/runtime/index.ts`:

```ts
export { createPerUserRuntimePool } from './per-user-pool';
export type { CopilotRuntime, CopilotRuntimePool, CreatePerUserRuntimePoolOptions } from './types';
```

- [ ] **Step 4.6: Run runtime tests**

Run: `npm test -- --run src/lib/copilot/runtime/per-user-pool.test.ts`

Expected: PASS.

- [ ] **Step 4.7: Commit Task 4**

```bash
git add src/lib/copilot/runtime
git commit -m "feat: add copilot runtime pool contracts" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Update architecture docs for implemented foundation

**Files:**
- Modify: `docs/architecture-multitenant.md`
- Modify: `docs/deployment-aca.md`
- Modify: `docs/superpowers/specs/2026-05-22-copilot-worker-pool-design.md`

- [ ] **Step 5.1: Document new boundary**

In `docs/architecture-multitenant.md`, add a short subsection under the current runtime limitation:

```md
### Execution boundary foundation

The first worker-pool implementation phase introduces `src/lib/copilot/execution/`
as the boundary between API routes and Copilot SDK session factories. The initial
adapter still runs in-process, preserving current behavior while making the route
layer independent of the runtime location.
```

- [ ] **Step 5.2: Document dispatcher boundary**

In `docs/deployment-aca.md`, add:

```md
### Worker-ready dispatch boundary

Background jobs now pass through `src/app/api/jobs/dispatcher.ts`. The default
dispatcher still schedules in-process work with `setImmediate`, but the route no
longer owns executor selection directly. A later phase can replace the dispatcher
with Service Bus or another private worker transport without changing the job API
payload contract.
```

- [ ] **Step 5.3: Mark spec implementation status**

In `docs/superpowers/specs/2026-05-22-copilot-worker-pool-design.md`, update status line:

```md
**Status**: Foundation Implemented
```

- [ ] **Step 5.4: Run markdown diff check**

Run: `git --no-pager diff --check`

Expected: exit 0.

- [ ] **Step 5.5: Commit Task 5**

```bash
git add docs/architecture-multitenant.md docs/deployment-aca.md docs/superpowers/specs/2026-05-22-copilot-worker-pool-design.md
git commit -m "docs: describe copilot worker foundation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Final validation

**Files:**
- No new files.

- [ ] **Step 6.1: Run TypeScript**

Run: `npx tsc --noEmit --pretty false`

Expected: exit 0.

- [ ] **Step 6.2: Run lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 6.3: Run tests**

Run: `npm test -- --run`

Expected: all test files pass.

- [ ] **Step 6.4: Run build**

Run: `npm run build`

Expected: exit 0.

- [ ] **Step 6.5: Run maintainability gate**

Run: `npm run maintainability:check`

Expected: exit 0. If file-size ratchets fail because new files are tracked, update `scripts/check-file-size.mjs` only after confirming the new files are focused and below nearby domain sizes.

- [ ] **Step 6.6: Commit validation-only ratchet updates if needed**

If Step 6.5 required ratchet updates:

```bash
git add scripts/check-file-size.mjs
git commit -m "chore: update worker foundation ratchets" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

If no ratchet updates were needed, skip this step.

## Verification Commands Summary
| Step | Command | Expected |
|------|---------|----------|
| 1.2 | `npm test -- --run src/lib/copilot/execution/in-process.test.ts` | Fails before implementation |
| 1.6 | `npm test -- --run src/lib/copilot/execution/in-process.test.ts` | Passes |
| 2.3 | `npm test -- --run src/app/api/copilot/route.test.ts` | Fails before route migration |
| 2.6 | `npm test -- --run src/app/api/copilot/route.test.ts src/lib/copilot/execution/in-process.test.ts` | Passes |
| 3.2 | `npm test -- --run src/app/api/jobs/dispatcher.test.ts` | Fails before dispatcher |
| 3.5 | `npm test -- --run src/app/api/jobs/dispatcher.test.ts src/app/api/jobs/route.test.ts` | Passes |
| 4.2 | `npm test -- --run src/lib/copilot/runtime/per-user-pool.test.ts` | Fails before runtime pool |
| 4.6 | `npm test -- --run src/lib/copilot/runtime/per-user-pool.test.ts` | Passes |
| 5.4 | `git --no-pager diff --check` | Passes |
| 6.1 | `npx tsc --noEmit --pretty false` | Passes |
| 6.2 | `npm run lint` | Passes |
| 6.3 | `npm test -- --run` | Passes |
| 6.4 | `npm run build` | Passes |
| 6.5 | `npm run maintainability:check` | Passes |

## Rollback Plan
| Phase | Command |
|-------|---------|
| Task 1 | `git revert <task-1-commit>` |
| Task 2 | `git revert <task-2-commit>` |
| Task 3 | `git revert <task-3-commit>` |
| Task 4 | `git revert <task-4-commit>` |
| Task 5 | `git revert <task-5-commit>` |

## Specialist Sign-Off
| Specialist | Status | Notes |
|------------|--------|-------|
| Architecture | approve | Indirection-first plan matches the approved spec and avoids a service rewrite in one PR. |
| Security | approve | Token-free job payloads and request-time identity remain intact. |
| Test | approve | Each behavioral seam has a red/green test before route or dispatcher migration. |
| Operations | concern | External worker service and real CLI process isolation remain future phases after SDK auth behavior is verified. |

## Execution Handoff
- **Start At**: Task 1.
- **Recommended Execution**: Subagent-driven development, one task per agent with review between tasks.
- **Final Verification**: `npx tsc --noEmit --pretty false && npm run lint && npm test -- --run && npm run build && npm run maintainability:check`.
