# Worker Job Execution Split Design

**Status**: Foundation implemented
**Date**: 2026-05-22

## Resumption Section
- **Scope**: Move background job execution from the web process to the Copilot worker process.
- **Current Phase**: Core implementation delivered; hardening and final smoke remain.
- **Next Action**: Complete architecture guard/doc follow-ups and final Aspire smoke verification.
- **Blockers**: None.

## Job Story
When users trigger chat, evaluation, or regeneration jobs, we want the web app to persist and orchestrate the job while the worker process executes it, so Copilot sessions and runtime telemetry belong to the worker service instead of the web service.

## Current State
- Public `/api/copilot` requires the worker and uses per-user worker runtimes.
- `/api/jobs` still calls `dispatchJobExecution()` in the web process.
- `dispatchJobExecution()` imports job executors directly and schedules them with `setImmediate`.
- Job executors create Copilot sessions and register cancellable sessions in the process-local session registry.
- Aspire traces show `copilot.session.create` under `flight-school` for `POST /api/jobs`.

## Goals
1. Web `/api/jobs` persists jobs and sends execution to the worker.
2. Worker owns executor imports, Copilot sessions, process-local session registry, and executor storage adapters.
3. Web cancellation forwards best-effort cancellation to the worker.
4. Worker rejects non-worker routes and worker endpoints require the shared bearer secret.
5. Tests prevent reintroducing web-side executor/session imports or direct Copilot SDK/session imports.
6. Local worker mode works without Cosmos by letting the worker receive refresh material needed to seed its own token store.
7. Web-side architecture guards cover all `src/app/**`, not just `/api/jobs`.

## Non-Goals
- Service Bus/KEDA durable queues.
- Splitting the repository into multiple packages.
- Moving job storage off the shared filesystem.
- Rewriting the job executor internals.

## Design Decisions
| ID | Decision | Rationale |
|---|---|---|
| DD1 | Add worker-internal job execute/cancel routes | Keeps the current local architecture and enables worker telemetry without durable queue complexity. |
| DD2 | Return quickly from worker execute route | Preserves fire-and-forget web behavior and avoids long HTTP requests. |
| DD3 | Move dispatch contracts to `src/lib/jobs/dispatch.ts` | Lets web and worker share request shape without importing route modules. |
| DD4 | Move executor implementation files to `src/worker/jobs` | Makes service ownership visible to humans and future agents, not just implicit in HTTP routing. |
| DD5 | Add architecture tests banning worker imports from web routes | Prevents fallback paths and web-side session execution from creeping back in. |
| DD6 | Include worker credential seed material only for trusted local/dev web-to-worker dispatch | Local `InMemoryTokenStore` is per process; production shared stores should not need dispatch-body credentials. |
| DD7 | Treat storage cancellation as source of truth and keep pending worker cancellation markers | Cancellation may arrive before a worker session is registered; the worker must remember cancellation intent. |

## Code Ownership Model
| Zone | Path | Owns | Must Not Import |
|---|---|---|---|
| Web/UI/API | `src/app/**`, except `src/app/api/internal/**` | UI, public API routes, job create/list/cancel orchestration | `src/worker/**`, `@github/copilot-sdk`, `@/lib/copilot/server`, `@/lib/copilot/streaming` |
| Worker route adapters | `src/app/api/internal/**` | Thin HTTP bearer-auth adapters into worker modules | UI/client modules |
| Worker implementation | `src/worker/**` | Job executors, worker session registry, per-user runtime use, executor storage adapters | Browser/client modules |
| Shared contracts/primitives | `src/lib/**` | Job types, dispatch DTOs, storage utilities, auth token store/resolver | Route modules |

## Acceptance Criteria
| ID | Criterion | Testable? |
|---|---|---|
| AC1 | Web dispatcher posts job execution requests to worker URL | Yes |
| AC2 | Worker internal execute route schedules job execution in worker process | Yes |
| AC3 | Web-side job routes/dispatcher no longer import worker executors, worker session registry, or Copilot session factories | Yes |
| AC4 | Worker cancel route destroys worker-local registered sessions | Yes |
| AC5 | `/api/jobs/[id]` forwards cancellation to worker after marking storage cancelled | Yes |
| AC6 | Docs state job execution is worker-owned and Service Bus remains future work | Yes |
| AC7 | Dispatch failure marks the persisted job failed instead of leaving it pending forever | Yes |
| AC8 | Worker verifies `job.userId === request.userId` before executing | Yes |
| AC9 | Architecture guard scans all web `src/app/**` files outside internal worker routes | Yes |
| AC10 | Worker-side cancellation handles cancel-before-session-registration | Yes |

## Target Flow

```mermaid
flowchart LR
  Browser --> WebJobs[POST /api/jobs]
  WebJobs --> JobStorage[(jobStorage)]
  WebJobs --> WebDispatcher[web dispatcher]
  WebDispatcher --> WorkerExecute[/api/internal/jobs/execute]
  WorkerExecute --> WorkerExecutor[worker job executor]
  WorkerExecutor --> Copilot[Copilot SDK/session/runtime]
  Browser --> WebCancel[DELETE /api/jobs/:id]
  WebCancel --> JobStorage
  WebCancel --> WorkerCancel[/api/internal/jobs/cancel]
```

## Error Handling
- Web dispatch failures mark the job failed with a clear dispatch error.
- Worker execute route returns 202 after enqueueing work locally.
- Worker execute route marks the job running before returning 202 and no-ops replayed non-pending jobs.
- Worker executor failures mark the job failed via existing executor behavior.
- Worker cancel failures are logged and do not prevent job storage cancellation; storage cancellation remains source of truth.
- Worker cancellation stores pending cancellation markers so a session registered after cancellation is immediately destroyed.

## Testing Strategy
- Unit test worker client auth URL, no-token payload, non-2xx errors.
- Unit test dispatcher calls worker client, not executors.
- Route test worker execute/cancel auth and enqueue behavior.
- Architecture test bans `src/worker/**`, executor/session, and direct Copilot session imports from all web `src/app/**` files outside `src/app/api/internal/**`.
- Worker execute route test verifies job ownership before execution.
- Final verification includes typecheck, lint, Vitest, build, maintainability, Aspire build, and Bicep build.

## Handoff for Planning
- **Affected Domains**: [x] Test [ ] E2E [ ] Accessibility [x] Performance [x] Code Quality [x] Technical Writing [ ] Infrastructure
- **Files**: `src/lib/jobs/dispatch.ts`, `src/app/api/jobs/dispatcher.ts`, `src/app/api/jobs/worker-client.ts`, `src/app/api/internal/jobs/*`, `src/worker/jobs/*`, `src/app/api/jobs/[id]/route.ts`, docs.
- **Risks**: Cancellation remains best-effort until durable queue/workers exist; worker and web share local filesystem in this slice.
