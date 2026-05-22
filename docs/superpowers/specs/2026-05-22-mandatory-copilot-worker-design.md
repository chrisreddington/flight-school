# Mandatory Copilot Worker Design

**Status**: Approved for planning
**Date**: 2026-05-22

## Resumption Section
- **Scope**: Remove the public in-process Copilot execution fallback and make the worker boundary mandatory for Copilot chat.
- **Current Phase**: Design approved; ready for implementation planning.
- **Next Action**: Write the implementation plan.
- **Blockers**: None.

## Job Story
When Flight School runs AI features for multiple GitHub users, we want public request paths to fail fast unless the Copilot worker is configured, so users never unknowingly execute through the shared web-process runtime.

## Current State
- `executeCopilotChat()` uses `COPILOT_WORKER_URL` when present, otherwise falls back to `executeCopilotChatInProcess()`.
- Local worker mode now creates one SDK-spawned Copilot runtime per `userId`.
- `npm run dev` starts only the web app, making the risky fallback the easiest path.
- `npm run aspire:run` starts the intended web + worker architecture.
- The in-process helper is still useful inside the worker implementation only as a test seam/shared helper, but not as a public route fallback.

## Goals
1. Make `COPILOT_WORKER_URL` mandatory for public Copilot chat execution.
2. Keep worker-internal execution helpers but remove public fallback behavior.
3. Make `npm run dev` guide developers to worker mode instead of silently starting unsafe single-process AI.
4. Keep a clearly named web-only command for non-AI UI debugging.
5. Update docs and tests so the architecture cannot regress.

## Non-Goals
- Removing the worker's runtime/session helper code.
- Removing local Next.js development entirely.
- Changing background jobs to Service Bus/KEDA.
- Changing GitHub OAuth, token storage, or worker bearer-secret auth.

## Approaches Considered
| Option | Summary | Pros | Cons | Decision |
|---|---|---|---|---|
| A | Fail fast when worker URL is missing; `dev` points to Aspire; explicit `dev:web-only` for UI-only debugging | Aligns with architecture; safe default; still practical for UI work | Requires dev muscle-memory update | **Chosen** |
| B | Keep fallback behind `COPILOT_ALLOW_IN_PROCESS=true` | Emergency escape hatch | Still a privacy footgun and likely to drift from architecture | Rejected |
| C | Delete every in-process helper | Strongest deletion | Duplicates worker runtime logic or removes useful test seam | Rejected |

## User Stories

### Must Have
- [ ] **S1**: As a user, I want public Copilot chat to require the worker, so my request does not run in a shared web-process runtime.
  - AC1.1: `executeCopilotChat()` throws when `COPILOT_WORKER_URL` is unset.
  - AC1.2: The thrown error does not include tokens or prompt text.
  - AC1.3: `/api/copilot` returns an explicit configuration error when the worker is missing.

- [ ] **S2**: As a developer, I want local commands to make the safe path obvious.
  - AC2.1: `npm run dev` starts the recommended web + worker path or prints guidance and exits.
  - AC2.2: A clearly named command, `npm run dev:web-only`, starts the web app without promising AI support.
  - AC2.3: Manual worker commands remain available.

- [ ] **S3**: As a maintainer, I want tests to prevent fallback regression.
  - AC3.1: Unit tests prove no worker config throws.
  - AC3.2: Route tests prove public chat does not call the in-process helper when worker config is missing.
  - AC3.3: Docs no longer say leaving `COPILOT_WORKER_URL` unset uses the in-process adapter for Copilot features.

## Acceptance Criteria Summary
| ID | Criterion | Testable? | Story |
|---|---|---|---|
| AC1.1 | Missing worker URL throws | Yes | S1 |
| AC1.2 | Error excludes sensitive data | Yes | S1 |
| AC1.3 | `/api/copilot` surfaces config error | Yes | S1 |
| AC2.1 | `dev` no longer silently starts unsafe AI path | Yes | S2 |
| AC2.2 | `dev:web-only` exists | Yes | S2 |
| AC2.3 | Manual worker commands remain | Yes | S2 |
| AC3.1-3.3 | Regression tests/docs updated | Yes | S3 |

## Design Decisions
| ID | Decision | Rationale |
|---|---|---|
| DD1 | Remove public fallback instead of adding an override | The user explicitly wants fail-forward due to privacy/architecture risk. |
| DD2 | Keep `executeCopilotChatInProcess()` but stop exporting it as public fallback | Worker/tests still need shared execution paths; the public selector no longer uses it. |
| DD3 | Make `npm run dev` point to Aspire | Safe architecture becomes the shortest command. |
| DD4 | Add `dev:web-only` | UI-only work remains possible without implying Copilot features are supported. |

## Target Behavior
- `npm run dev` runs `npm run aspire:run`.
- `npm run dev:web-only` runs `next dev`.
- `npm run dev:worker` runs `next dev --port 3001`.
- `npm run dev:web-worker` runs web-only with worker env for two-terminal manual mode.
- `executeCopilotChat()` requires worker config and calls `executeCopilotChatViaWorker()`.
- Worker route continues to use the per-user runtime pool.

## Error Handling
- Missing `COPILOT_WORKER_URL` throws `CopilotWorkerRequiredError`.
- The error message is generic: `Copilot worker is required for chat execution. Start the app with npm run aspire:run or configure COPILOT_WORKER_URL.`
- Route error handling returns a safe 500 body or existing config-error mapping without echoing prompts/tokens.

## Testing Strategy
- Unit test `executeCopilotChat()` for missing worker config.
- Unit test worker-config path still calls HTTP client.
- Route test missing worker config returns safe error and never calls in-process execution.
- Script/docs checks through package JSON assertions or focused tests if existing architecture tests cover scripts.
- Final gate remains TypeScript, lint, Vitest, build, maintainability, Aspire build, Bicep build.

## Specialist Sign-Off
| Specialist | Status | Notes |
|---|---|---|
| Architecture | approve | Aligns public AI execution with worker-only architecture. |
| Security | approve | Removes the privacy footgun rather than hiding it behind an override. |
| Developer Experience | approve with note | `dev:web-only` preserves quick UI debugging while making AI worker requirements explicit. |

## Handoff for Planning
- **Affected Domains**: [x] Test [ ] E2E [ ] Accessibility [ ] Performance [x] Code Quality [x] Technical Writing [ ] Infrastructure
- **Migration Strategy**: Fail-forward; safe command defaults; no compatibility fallback.
- **Files**: `src/lib/copilot/execution/*`, `/api/copilot` tests, `package.json`, `.env.example`, `README.md`, `docs/architecture-multitenant.md`.
- **Risks**: `npm run dev` invoking Aspire may surprise contributors; docs and `dev:web-only` must make the distinction clear.
