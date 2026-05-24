---
name: copilot-sdk-worker-only
description: |
  Use whenever you are writing, reviewing, or refactoring any code that
  touches the GitHub Copilot SDK (`@github/copilot-sdk`). Enforces the
  non-negotiable architectural rule that **all** SDK execution — chat,
  coach, lightweight coach, evaluation, hints, quiz, suggestions, focus
  generation, README generation, anything that calls `createSession` or
  `sendAndWait` — happens inside the Copilot Worker process and never
  inside Next.js (Web/API). Trigger phrases: "Copilot SDK", "createSession",
  "createLoggedCoachSession", "sendAndWait", "MCP", "copilot worker",
  "AI generation", "focus generation", "hint generation".
---

# Copilot SDK is worker-only

> **Web/API is forbidden from importing `@github/copilot-sdk` or any
> module that creates a Copilot session. AI execution lives in the
> worker. Always.**

This is the most important architectural invariant in Flight School.
It is not a guideline. It is a contract.

## Why this rule exists

The Web/API tier serves authenticated user requests. The Copilot SDK
spawns Copilot CLI subprocesses, opens MCP connections, and holds
long-lived per-user state. Mixing those concerns inside Next.js produces:

- **Tenant leakage.** A shared CopilotClient at module scope inevitably
  gets reused across users; the SDK's per-session token is the only safe
  barrier and it is easy to bypass accidentally.
- **Cold-start tax on every request.** SDK startup is heavyweight; the
  worker amortises it across a pool. Web/API would pay the cost per
  request.
- **No back-pressure.** The worker bounds concurrency per user and per
  process; Web/API has no equivalent and would happily spawn N CLI
  processes for N concurrent requests.
- **Crash blast radius.** An SDK process crash inside Next.js kills the
  whole web server. Inside the worker it kills a single job.
- **Observability holes.** All AI telemetry (spans, metrics, audit) is
  centralised on the worker boundary. In-process calls bypass it.

If any of those start sounding negotiable, re-read this section.

## The contract

| Rule | Allowed | Forbidden |
| --- | --- | --- |
| `import { CopilotClient } from '@github/copilot-sdk'` | `src/worker/**`, `src/lib/copilot/runtime/**` | everywhere else |
| `import { createLoggedCoachSession, createLoggedLightweightCoachSession }` from `@/lib/copilot/server` | `src/worker/**` | `src/app/**`, `src/lib/**` outside the worker, hooks, components, tests of non-worker code |
| `import { createSession, createSessionWithMetrics }` from `@/lib/copilot/sessions` | `src/lib/copilot/runtime/**`, `src/worker/**` | everywhere else |
| `session.sendAndWait`, `session.on(...)` on a real (non-mocked) session | inside a worker job executor | anywhere in Web/API |

Web/API talks to AI **only** via the worker dispatch primitives:

```ts
// chat → already correct
import { executeCopilotChat } from '@/lib/copilot/execution';

// non-chat (coach / lightweight / evaluation / hint / quiz / focus /
// readme) → must use the equivalent worker dispatch primitive. There
// is one canonical helper per job kind, exposed from
// `@/lib/copilot/execution` (NOT from `@/lib/copilot/server`).
import { executeCopilotCoachJob } from '@/lib/copilot/execution';
```

If a worker dispatch primitive does not yet exist for the job you need,
**build it before adding the feature** — do not "temporarily" call the
SDK in-process. There are no temporary exceptions.

## Where the boundary lives in the tree

```
src/app/**                  ← Web/API. Never imports the SDK.
src/lib/<feature>/**        ← Feature code. Calls execute*Job helpers.
src/lib/copilot/execution/  ← Worker dispatch primitives (HTTP client +
                              types + worker-required error). Web/API's
                              ONLY entry point into AI execution.
src/lib/copilot/server.ts   ← Session factories. Worker-internal.
src/lib/copilot/sessions.ts ← CopilotClient construction + session pool.
                              Worker-internal.
src/lib/copilot/runtime/**  ← Per-user runtime pool. Worker-internal.
src/worker/**               ← Worker process: job executors actually
                              call createSession / sendAndWait here.
```

The `@/lib/copilot/server` module is the boundary mistake magnet. Its
exports look harmless and importable; they are not. Reviewers should
treat any new import of it outside `src/worker/**` as a defect.

## CI enforcement

`scripts/check-copilot-sdk-boundary.mjs` (lands with this skill) walks
the dependency graph and fails the build if:

- Any file under `src/app/**` imports `@github/copilot-sdk` directly.
- Any file under `src/app/**` or `src/lib/**` (outside `src/lib/copilot/runtime/**`, `src/lib/copilot/execution/**`, `src/lib/copilot/server.ts`, `src/lib/copilot/sessions.ts`, `src/lib/copilot/logged-session.ts`, and tests of those) imports `createLoggedCoachSession`, `createLoggedLightweightCoachSession`, `createSession`, `createSessionWithMetrics`, or `wrapSessionWithLogging`.
- Any file outside `src/worker/**` calls `.sendAndWait(` or `.on('assistant.message',` on a value originating from those factories.

The script has **no name-based allowlist** and **no `// boundary-ok:`
escape hatch**. If you need to expand the worker dispatch surface,
add a new primitive to `src/lib/copilot/execution/` and call that.

## Architecture test backstop

`src/test/architecture/copilot-sdk-boundary.test.ts` walks every file
under `src/app/**` and asserts the import graph never reaches
`@github/copilot-sdk`. This catches transitive leaks that a flat grep
would miss (e.g. a hook re-exporting a session factory).

## Adding a new AI job kind

When a new feature needs Copilot SDK output:

1. Add the job kind to `src/worker/jobs/types.ts`.
2. Implement the executor in `src/worker/jobs/executors/<kind>.ts`.
   This is the **only** place that imports `createLoggedCoachSession`
   et al. and calls `sendAndWait`.
3. Add a thin dispatch helper to `src/lib/copilot/execution/` that
   posts the request to the worker and returns the typed result. Use
   `executeCopilotChat` / `executeCopilotChatViaWorker` as the
   reference shape.
4. Web/API and feature code import the helper from step 3 — never the
   factories from step 2.
5. Update `docs/architecture-multitenant.md`'s data-flow diagram and
   the "How This Project Uses the SDK" section of
   [`.github/skills/copilot-sdk/SKILL.md`](../copilot-sdk/SKILL.md) if
   the new job kind expands the public worker contract.

## Red flags in a diff

Stop and reject if you see any of these in a PR:

- `import … from '@github/copilot-sdk'` outside `src/worker/**` /
  `src/lib/copilot/runtime/**`.
- `import { createLoggedCoachSession }` (or any `createLogged*Session`)
  in a file under `src/app/**` or `src/lib/<feature>/**`.
- `await session.sendAndWait(` outside `src/worker/jobs/executors/**`.
- A new helper in `src/lib/copilot/server.ts` that exports a session
  factory — these belong inside the worker now, not on the shared
  surface.
- A "// TODO: move this to the worker later" comment. There is no
  later. Move it now or do not ship it.
- A test that mocks `createLoggedCoachSession` at a non-worker call
  site — the production code is doing the wrong thing if the mock is
  needed there.

## Self-check before requesting review

- [ ] No new import of `@github/copilot-sdk` outside the allowed
      directories.
- [ ] No new import of any `createLogged*Session` / `createSession*`
      factory outside `src/worker/**`.
- [ ] Every new AI capability is reachable from Web/API only via a
      helper in `src/lib/copilot/execution/`.
- [ ] `npm run check:copilot-sdk-boundary` passes locally.
- [ ] If a new worker job kind was added, the architecture doc and
      `copilot-sdk` skill reflect it.

If any box is unticked, the change is not ready.
