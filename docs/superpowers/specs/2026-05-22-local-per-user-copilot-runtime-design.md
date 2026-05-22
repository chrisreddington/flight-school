# Local Per-user Copilot Runtime Design

**Status**: Foundation Implemented
**Date**: 2026-05-22

## Resumption Section
- **Scope**: Make the local worker exercise actual per-user Copilot CLI process and state isolation.
- **Current Phase**: Foundation implemented.
- **Next Action**: Manually exercise `npm run aspire:run` with two signed-in users and inspect runtime homes/processes.
- **Blockers**: None.

## Job Story
When running Flight School locally with the worker service, we want each GitHub user to get a separate Copilot SDK-managed CLI child process and `COPILOT_HOME`, so local development validates the isolation model intended for production.

## Current State
- The web app can call a separate local worker process over HTTP.
- The worker route currently executes chat through the normal in-process adapter.
- `src/lib/copilot/runtime/` has a generic per-user pool, but its runtime only exposes `disconnect()`.
- The installed `@github/copilot-sdk@1.0.0-beta.4` supports SDK-spawned CLI processes with `copilotHome`, `gitHubToken`, and `useLoggedInUser: false`.
- The installed SDK rejects `cliUrl` combined with `gitHubToken` or `useLoggedInUser`, so external shared CLI servers are not the local isolation path.

## Goals
1. Create one SDK-managed Copilot CLI child process per user in the worker.
2. Give each runtime a user-specific `COPILOT_HOME` under a local data root.
3. Keep runtime creation, reuse, eviction, and shutdown observable in logs/tests.
4. Execute worker chat requests through the user runtime rather than the worker's shared adapter.
5. Preserve web-process behavior for non-chat surfaces while public chat requires the worker.

## Non-Goals
- Service Bus/KEDA async job workers.
- External `cliUrl` runtime servers.
- Production-grade per-user container isolation.
- Changing Auth.js, token storage, or browser session data.
- Removing the existing singleton in-process adapter used by fallback mode.

## Approaches Considered
| Option | Summary | Pros | Cons | Decision |
|---|---|---|---|---|
| A | SDK-managed `CopilotClient` per user with `copilotHome` and client token | Supported by installed SDK; true local child-process isolation; no manual CLI protocol | One worker process still owns many child processes | **Chosen** |
| B | External CLI server per user via `cliUrl` | Clear network boundary | Installed SDK cannot combine `cliUrl` with token options; auth ownership becomes unclear | Rejected |
| C | Simulated runtime objects only | Easy tests | Does not validate process/state isolation | Rejected |

## User Stories

### Must Have
- [ ] **S1**: As a developer, I can run local worker mode and see one runtime created per user.
  - AC1.1: Runtime key is stable GitHub `userId`.
  - AC1.2: Runtime exposes `userId`, `copilotHome`, and `executeChat()`.
  - AC1.3: Runtime logs lifecycle events without logging GitHub tokens.

- [ ] **S2**: As a maintainer, I want worker chat execution to use the runtime pool.
  - AC2.1: `/api/_internal/copilot/execute` calls a worker runtime executor.
  - AC2.2: The executor reuses an existing runtime for the same user.
  - AC2.3: Different users do not share a `CopilotClient` or `COPILOT_HOME`.

- [ ] **S3**: As an operator, I want runtime caps and cleanup.
  - AC3.1: Configurable `COPILOT_RUNTIME_IDLE_TTL_MS`.
  - AC3.2: Configurable `COPILOT_RUNTIME_MAX_ACTIVE`.
  - AC3.3: Worker shutdown calls `shutdown()` and stops active clients.

- [ ] **S4**: As a reviewer, I want clear evidence that SDK capability assumptions are true.
  - AC4.1: Docs cite the installed SDK behavior: `copilotHome` works only for SDK-spawned CLI.
  - AC4.2: Docs state `cliUrl + gitHubToken` is not supported by the installed SDK.

## Acceptance Criteria Summary
| ID | Criterion | Testable? | Story |
|---|---|---|---|
| AC1.1 | Runtime keyed by `userId` | Yes | S1 |
| AC1.2 | Runtime exposes home and chat execution | Yes | S1 |
| AC1.3 | No token logging in lifecycle | Yes | S1 |
| AC2.1 | Worker route uses runtime executor | Yes | S2 |
| AC2.2 | Same user reuses runtime | Yes | S2 |
| AC2.3 | Different users get distinct clients/homes | Yes | S2 |
| AC3.1 | Idle TTL configurable | Yes | S3 |
| AC3.2 | Max active runtimes configurable | Yes | S3 |
| AC3.3 | Shutdown stops clients | Yes | S3 |
| AC4.1-4.2 | SDK constraints documented | Yes | S4 |

## Design Decisions
| ID | Decision | Rationale |
|---|---|---|
| DD1 | Use one SDK-spawned `CopilotClient` per user runtime | This is the installed SDK-supported way to isolate process and `COPILOT_HOME` while still supplying user tokens. |
| DD2 | Keep per-session `gitHubToken` when creating sessions | Maintains current identity semantics and is consistent with SDK multitenancy docs. |
| DD3 | Put local runtime homes under `${FLIGHT_SCHOOL_DATA_DIR}/copilot-runtimes/{safeUserId}` or an OS temp fallback | Keeps state out of the repo and makes local inspection easy. |
| DD4 | Extend the existing runtime pool instead of creating a second pool | Reuses tested TTL/capacity behavior and reduces new surface area. |
| DD5 | Only worker mode uses per-user runtime clients initially | Public chat now requires the worker; non-chat Copilot surfaces are outside this slice. |

## Target Architecture

```mermaid
flowchart LR
  Web[Web app] --> WorkerRoute[/api/_internal/copilot/execute]
  WorkerRoute --> Executor[Worker chat executor]
  Executor --> Pool[Per-user runtime pool]
  Pool --> RuntimeA[Runtime user A]
  Pool --> RuntimeB[Runtime user B]
  RuntimeA --> ClientA[CopilotClient A]
  RuntimeB --> ClientB[CopilotClient B]
  ClientA --> HomeA[COPILOT_HOME A]
  ClientB --> HomeB[COPILOT_HOME B]
  ClientA --> CliA[CLI child process A]
  ClientB --> CliB[CLI child process B]
```

## Runtime Behavior
- Runtime creation builds a sanitized user home path and constructs `new CopilotClient({ gitHubToken, useLoggedInUser: false, copilotHome })`.
- Runtime execution creates the same chat/GitHub-chat session shape as the existing adapter, but with that runtime's client.
- Runtime disconnect calls `client.stop()` and, if needed, `client.forceStop()`.
- Pool eviction uses existing idle/capacity logic and logs userId plus reason only.
- Invalid runtime config fails at worker startup/request time with explicit errors.

## Testing Strategy
- Unit test config parsing for TTL/max-active/home-root.
- Unit test runtime factory with a mocked `CopilotClient` to prove distinct user homes and clients.
- Unit test executor reuse with fake runtimes.
- Update worker route tests to assert it calls the runtime executor, not the in-process adapter.
- Keep full final gate: TypeScript, lint, Vitest, build, maintainability, Aspire build, Bicep build.

## Specialist Sign-Off
| Specialist | Status | Notes |
|---|---|---|
| Architecture | approve | Uses the installed SDK-supported process boundary instead of unsupported external CLI auth. |
| Security | approve | User token stays inside the worker request and runtime creation path; lifecycle logs must omit it. |
| Operations | concern | Local worker can create multiple child processes, so caps and idle TTL must be conservative by default. |

### Key Specialist Recommendations
- **Architecture**: Extract shared session execution logic so the existing adapter and runtime executor do not drift.
- **Security**: Sanitize user IDs before using them in paths.
- **Operations**: Default to low local capacity, e.g. 3 active runtimes and 10-minute idle TTL.

## Handoff for Planning
- **Affected Domains**: [x] Test [ ] E2E [ ] Accessibility [x] Performance [x] Code Quality [x] Technical Writing [x] Code Documentation [ ] Infrastructure
- **Migration Strategy**: Wire runtime pool into worker route only; keep web fallback unchanged.
- **Files**: `src/lib/copilot/runtime/*`, `src/lib/copilot/execution/*`, `src/app/api/_internal/copilot/execute/route.ts`, worker docs.
- **Risks**: If SDK constructor behavior changes in a future release, `cliUrl + token` compatibility must be rechecked before switching away from SDK-spawned runtimes.
