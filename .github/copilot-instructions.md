# Flight School - Copilot Instructions

> [!WARNING]
> **Exploratory project — not a reference.** Flight School is a
> single-developer side project, mid-iteration. The patterns below describe
> the current state of the codebase, not recommended best practices. Expect
> antipatterns, half-finished refactors, and inconsistencies. When working in
> this repo, follow the conventions documented here for *consistency with
> existing code*, but do not assume any pattern here is a reference for use
> elsewhere.

## Architecture Overview

> For the full story (with diagrams, sequence flows, Aspire local-dev,
> and storage/observability layout), see
> [`docs/architecture.md`](../docs/architecture.md). The deep
> multi-tenant invariants live in
> [`docs/architecture-multitenant.md`](../docs/architecture-multitenant.md).

Next.js 16 App Router application on React 19.2 with Primer React UI. All API calls to GitHub and AI providers happen server-side in `/api` routes (or Server Components / Server Actions) to protect credentials. Public Copilot chat execution is routed to a mandatory private worker service — a **standalone Hono/Node process** (not Next.js) that hosts the Copilot SDK and the per-user runtime pool. The Next-free boundary is enforced by [`scripts/check-worker-next-free.mjs`](../scripts/check-worker-next-free.mjs).

**Data Flow**: Dashboard → `/api/profile` (Octokit direct) → `/api/focus` (Copilot SDK creative generation) → UI

### Next 16 / React 19.2 build flags

`next.config.ts` enables two opt-in features that the rest of the codebase
must respect:

- **`reactCompiler: true`** — the compiler auto-memoises components, so don't add `useMemo` / `useCallback` / `React.memo` unless a profile shows it's needed. If a Primer component breaks the compiler's Rules of React, opt that file out with `"use no memo"` and leave a `TODO:` comment.
- **`experimental.cacheComponents: true`** — Partial Prerender mode. Any dynamic IO (cookies, request body, `usePathname`, `useSearchParams`, uncached `fetch`) must live below a `<Suspense>` boundary. Root layout already wraps `<Providers>` in `<Suspense>` to cover the breadcrumb context's `usePathname()` call.

**Route-segment config is forbidden under `cacheComponents`.** Do not add
`export const dynamic = '…'` or `export const runtime = 'nodejs'` to any
route — Next 16 infers dynamism from the route's actual API use, and Node
is the project-wide default. CI guard `scripts/check-server-fetch-tenancy.mjs`
enforces that every server-side `fetch` is either explicitly `cache: 'no-store'`,
tagged for revalidation, or annotated `// public-cache:` with a justification.

### Server Components for data-driven pages

Pages that load per-user JSON storage (e.g. `/skills`, `/habits`) render as
async Server Components. The pattern:

1. Page calls `requireGuardedRscContext('page.view')` from
   `@/lib/security/guard`; redirect to `/sign-in` if it returns `null`.
   This emits a `page.view` audit event and applies the per-user rate
   limit / session cap policy that protects API routes — RSC pages share
   the same guard primitive.
2. Page calls a server-side reader (`readUserSkillsProfile`,
   `readUserHabits`, …) backed by `src/lib/storage/user-storage.ts`. These
   helpers resolve the user, validate the path with `userScopedFilename`,
   and return the schema-checked payload.
3. Page hands the payload to a `_components/XxxClient.tsx` island marked
   `'use client'`. The island uses the data as its initial state and
   handles all subsequent interaction.

The storage-route API factory (`createStorageRoute`) delegates to the same
`resolveUserScopedPath` helper, so the API and RSC paths share one tenancy
implementation.

## Multi-tenant design

Flight School is **multi-tenant**: every request is authenticated as a specific
GitHub user via Auth.js v5 + a GitHub App OAuth flow, and that user's
`ghu_` user-to-server token is what downstream GitHub API calls and Copilot
SDK sessions use. There is **no process-wide token** and **no Octokit
singleton**. See [`docs/architecture-multitenant.md`](../docs/architecture-multitenant.md)
for the full design.

## GitHub API Access

This project uses the `octokit` package for direct GitHub API access and the
`@github/copilot-sdk` for AI-powered features. Both are bound per-request to
the authenticated user's token.

### Authentication (SINGLE SOURCE OF TRUTH)

In server code that handles an authenticated request — API routes, server
components, server actions — **resolve the user via
`@/lib/auth/context`** and let the GitHub/Copilot factories pick up the token
from there.

```typescript
import { requireUserContext, getUserContext } from '@/lib/auth/context';
import { getOctokitForRequest, getOctokitForToken } from '@/lib/github/client';

// In an API route handler:
const { userId, login, accessToken } = await requireUserContext(); // throws UnauthorizedError (401) if no session
const octokit = await getOctokitForRequest();                      // fresh, instrumented, bound to this user

// If you already have a token (e.g. inside a guard or background job):
const octokit2 = getOctokitForToken(accessToken);
```

Rules:

- **Per-request Octokit only.** Never cache or share an Octokit across users
  or across requests. `getOctokitForRequest()` constructs a fresh, instrumented
  instance every call.
- **Never read `process.env.GITHUB_TOKEN`.** There is no ambient identity in
  any environment, including local dev. The OAuth flow is the only auth path.
- **No `gh auth token` fallback.** The client module does not shell out;
  every token comes from the Auth.js session.
- **Hot AI routes should use `withGuardedRoute`** (`src/lib/security/guard.ts`),
  which composes `requireUserContext` + rate limit + concurrent-session cap +
  audit log + standard error → `NextResponse` mapping around the handler.
  The module exports three layered primitives:
  - `requireGuardedUserContext(policy)` — transport-agnostic core; returns
    `{ ctx, release }` (where `ctx` is the `UserContext`) or throws a typed
    error. Always call `release()` from a `finally` block. Use this from
    Server Actions and RSC data loaders.
  - `withUserGuards(opts, work)` — wraps the core for non-route callers that
    handle their own response shape (e.g. background jobs).
  - `withGuardedRoute(opts, work)` — the route adapter: maps `UnauthorizedError`
    and entitlement errors to the standard JSON responses automatically, so
    route handlers don't need an outer `knownApiErrorResponse` catch.

### `gh` CLI fallback is gone

There is no `gh auth token` lookup anywhere in the application. Local dev
must sign in through the same OAuth flow as production. The
`ACA_DEPLOYMENT` env var no longer affects token resolution.

### Copilot SDK: per-session GitHub identity

The `CopilotClient` lives inside the worker (`src/worker/jobs/executors/`).
The worker is a **standalone Hono/Node process** — `src/worker/bootstrap.ts`
is the Node entrypoint, `src/worker/server-main.ts` boots the Hono app at
`src/worker/http/app.ts`, and `src/worker/lifecycle/` holds OTel/warmup/
restart-sweep/shutdown. **Web/API never invoke the SDK in-process**. All
AI work — chat, coach, hints, authoring, evaluation — is dispatched to the
worker through `src/lib/copilot/execution/` (`executeCopilotChat`,
`executeCopilotCoachJob`, `openCopilotAuthoringStreamViaWorker`). See
`.github/skills/copilot-sdk-worker-only/SKILL.md`. Two CI scripts enforce
the boundary: `scripts/check-copilot-sdk-boundary.mjs` (SDK reachability)
and `scripts/check-worker-next-free.mjs` (no `next/*` reachable from the
worker entrypoint).

```typescript
import { executeCopilotCoachJob } from '@/lib/copilot/execution';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { requireUserContext } from '@/lib/auth/context';

const ctx = await requireUserContext();
const identity = createSessionIdentity(ctx);
const result = await executeCopilotCoachJob({
  identity,
  variant: 'lightweight',
  operationName: 'Daily focus',
  prompt,
  inputSummary: 'focus',
});
return result.response;
```

Chat session cache keys include `userId` so two users sharing a
`conversationId` can never collide.

### When to Use Which

| Need | Use | Why |
|------|-----|-----|
| Fetch user data | `octokit.rest.users.getAuthenticated()` | Fast, deterministic |
| List repositories | `octokit.rest.repos.listForAuthenticatedUser()` | Fast, deterministic |
| Get activity events | `octokit.rest.activity.listEventsForAuthenticatedUser()` | Fast, deterministic |
| Creative AI generation | `executeCopilotCoachJob` (worker dispatch) | AI adds real value |
| Multi-turn chat | `executeCopilotChat` (worker dispatch) | Conversation context |
| Streaming authoring | `openCopilotAuthoringStreamViaWorker` (worker SSE proxy) | Live token stream |

### Code Location

| Path | Purpose |
|------|---------|
| `src/lib/auth/` | Auth.js v5 config, user-context resolution, token store |
| `src/lib/github/` | Per-request Octokit factories + GitHub data access |
| `src/lib/copilot/execution/` | Worker-dispatch primitives — the ONLY SDK call paths from Web/API |
| `src/lib/copilot/` | Session-identity helpers, SDK adapters (worker-internal only) |
| `src/worker/jobs/executors/` | Where the SDK actually runs |
| `src/lib/security/` | `requireGuardedUserContext` / `withUserGuards` / `withGuardedRoute`, rate limit, session cap, audit log |

### Never Use SDK For

- Data fetching that APIs handle directly (use Octokit)
- Deterministic calculations (do them locally)
- Operations where LLM adds latency without value

## Critical Patterns

### Copilot SDK Usage (worker-only)

The SDK runs inside the worker. Web and API code dispatch to it via
`src/lib/copilot/execution/`:

- **Coach jobs** (focus, hints, quiz, suggestions, guided plans):
  `executeCopilotCoachJob({ identity, variant, operationName, prompt, inputSummary })`.
- **Multi-turn chat**: `executeCopilotChat(...)`.
- **Streaming authoring**: `openCopilotAuthoringStreamViaWorker(...)` —
  returns a `Response` whose body the public route pipes back to the client.

```typescript
// Dispatch a coach job from any authenticated route handler.
import { executeCopilotCoachJob } from '@/lib/copilot/execution';
import { createSessionIdentity } from '@/lib/copilot/session-identity';
import { withGuardedRoute } from '@/lib/security/guard';

export async function POST() {
  return withGuardedRoute(QUIZ_GUARD, async (ctx) => {
    const identity = createSessionIdentity(ctx);
    const result = await executeCopilotCoachJob({
      identity,
      variant: 'lightweight',
      operationName: 'Topic quiz',
      prompt,
      inputSummary: 'quiz',
    });
    return Response.json(result.response);
  });
}
```

### Graceful Degradation
**Always test without AI keys** - app must work with static content:

- `src/lib/fallback/static-suggestions.ts` provides curated content per language/level
- Check pattern: `isAIConfigured()` before AI calls, use `getFallback*()` functions
- API responses include `meta.aiEnabled` and `meta.fallbackReason`

### JSON Response Parsing
LLMs may wrap JSON in markdown - use multi-strategy extraction in `parseJSONResponse()`:

1. Extract from ` ```json ` code blocks
2. Find JSON by brace matching (`{` to `}`)
3. Direct parse as final fallback

### TanStack Query (client-side data cache)

Client hooks that own remote/JSON-storage data use **TanStack Query v5**
(`@tanstack/react-query`, pinned exactly — see PR #188). One `QueryProvider`
sits in the `<Providers>` chain at the browser root; tests get fresh
`QueryClient`s via `createQueryTestWrapper()` in `src/test/query-test-wrapper.tsx`.

Rules of the road:

- **Cache reads belong inside `queryFn`, never in `initialData`.** `initialData`
  is synchronous and would hydrate the server with client-only cache
  (localStorage, async APIs) — that breaks SSR and resets the staleness clock.
  See `use-guided-plan.ts` for the pattern: read cache → return if fresh →
  otherwise fetch and write cache.
- **v5 `useQuery` has no `onSuccess` / `onError` / `onSettled`.** Side effects
  on data go inside `queryFn` after the fetch. `useMutation` still has these
  callbacks; mutation `onSuccess` is where invalidations live.
- **Mutations: `mutateAsync` if callers `await` and expect rejections; `mutate`
  otherwise.** `useThreads.createThread` re-throws (callers
  `.rejects.toThrow(…)`); the rest swallow + log.
- **No hand-rolled `useMemo` / `useCallback` in components reading TanStack
  cache data.** The React Compiler memoizes correctly; a hand-written
  `useMemo(() => threads.find(...))` was caught returning stale results
  during the PR #188 migration. Let the compiler do its job.
- **Sign-out invariant — no user-scoped keys today.** Current sign-out is a
  full-page reload (`signOutAction redirectTo` + api-client 401 →
  `window.location.assign`), so the `QueryClient` is reborn per login. Any
  future SPA sign-out **MUST** call `queryClient.clear()` before redirecting,
  OR include `userId` in every query key. This invariant is documented in
  the TSDoc of `src/app/query-provider.tsx`.
- **Double dedup is intentional.** `src/lib/api-client.ts` has its own
  `pendingRequests` map for in-flight GET dedup; TanStack Query has its
  own. Both run; they don't conflict.
- **Cache-bypass refetch:** when a hook needs a "force refresh" action
  (e.g. a refresh button), use `cancelQueries({ queryKey })` followed by
  `fetchQuery({ queryKey, queryFn: bypassVariant, staleTime: 0 })`. Track
  concurrent calls with a ref-counted in-flight guard so the loading
  indicator only clears when the LAST overlapping refetch settles —
  without the counter, call 2's `cancelQueries` triggers TanStack's
  `revert: true` path which resolves call 1's wrapper promise
  immediately, leaving call 2 still in flight against the (deduped)
  network promise. See `src/hooks/use-user-profile.ts` `refetch()` for
  the reference implementation and the divergent-settlement regression
  test alongside it.

## Code Organization

| Path | Purpose |
|------|---------|
| `src/lib/*/types.ts` | Feature-scoped domain types (e.g. `src/lib/focus/types.ts`) |
| `src/lib/ai/providers/` | New AI backend implementations |
| `src/lib/expertise/` | GitHub data → skill level analysis |
| `src/components/*/` | Each component in own folder |
| `src/app/api/*/route.ts` | Server-side API endpoints |

## Testing

Vitest with mocked fetch (see `src/test/setup.ts`). Tests colocated as `*.test.ts`:

```bash
npm test              # All tests (non-interactive: vitest run)
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Pattern: Mock `process.env` for provider tests, mock `fetch` for API calls.

## Learning-Focused Chat Pattern

When creating learning-focused chat sessions, the AI should:

### Learning Lens Directives
1. **Explain reasoning** - Don't just give answers; show the thought process
2. **Suggest next steps** - Offer opportunities to explore deeper
3. **Connect to context** - Reference user's actual repos and activity when relevant
4. **Encourage experimentation** - Suggest hands-on exercises when appropriate

### System Prompt Pattern
```typescript
// Learning chat sessions should use prompts like:
const LEARNING_SYSTEM_PROMPT = `You are a developer learning companion.

When answering questions:
1. Explain your reasoning step-by-step
2. Connect concepts to the user's actual repositories when relevant
3. Suggest follow-up questions or experiments
4. If applicable, point to specific files or code patterns

Focus on building understanding, not just providing solutions.`;
```

### When to Apply Learning Lens
- User asks "why" or "how does this work"
- User is exploring new concepts
- User requests explanation or guidance

### When NOT to Apply Learning Lens
- User explicitly wants quick answer
- Time-sensitive questions
- Simple factual lookups

## Challenge Evaluation Pattern

The Challenge Sandbox uses AI to evaluate user solutions. See `src/lib/copilot/evaluation.ts`.

### Evaluation System Prompt
```typescript
// Evaluation prompts should assess correctness AND learning
const EVALUATION_SYSTEM_PROMPT = `You are evaluating a coding challenge solution.

Analyze the code for:
1. **Correctness**: Does it solve the problem?
2. **Code quality**: Is it readable, maintainable?
3. **Edge cases**: Are boundary conditions handled?
4. **Best practices**: Are language idioms used appropriately?

Provide constructive feedback that helps the learner improve.
Do NOT just say "wrong" - explain what's missing and why.`;
```

### Evaluation Response Format
```typescript
interface EvaluationResult {
  isCorrect: boolean;      // Did they solve the problem?
  score?: number;          // 0-100 quality score (optional)
  feedback: string;        // Main feedback message
  strengths: string[];     // What they did well
  improvements: string[];  // Specific areas to improve
  nextSteps?: string[];    // Suggested follow-up learning
}
```

### Streaming Evaluation
Evaluation uses streaming responses for immediate feedback:
- First token should arrive within 2 seconds (TTFT target)
- Stream partial results using Server-Sent Events
- Show loading indicator during evaluation

## Hint Generation Pattern

The hint system provides contextual help without giving away solutions. See `src/lib/copilot/hints.ts`.

### Hint System Prompt
```typescript
// Hints should guide, not solve
const HINT_SYSTEM_PROMPT = `You are helping a developer who is stuck on a coding challenge.

Rules:
1. NEVER give the full solution
2. Guide them toward discovery
3. Ask questions that prompt insight
4. Reference concepts they might have forgotten
5. Build on previous hints in the conversation

The goal is learning, not just getting the right answer.`;
```

### Hint Response Format
```typescript
interface HintResponse {
  hint: string;          // The contextual hint
  concepts: string[];    // Related concepts to review
  encouragement: string; // Motivational message
}
```

### Multi-Turn Hints
Hints maintain session context:
- Each hint builds on previous ones
- Conversation is scoped to the current challenge
- System tracks hint history to avoid repetition

## Challenge Authoring Pattern

The Challenge Authoring feature uses AI to help users create custom challenges. See `src/lib/copilot/authoring-session.ts`.

### Authoring System Prompt
```typescript
// Authoring sessions guide users through challenge creation:
const AUTHORING_SYSTEM_PROMPT = `You are helping a developer create a custom coding challenge.

Your role:
1. Understand what skill they want to practice
2. Ask clarifying questions (difficulty, language, constraints)
3. Generate a well-structured challenge when you have enough context

Guidelines:
- Start by asking what they want to learn or practice
- Keep questions focused - one topic at a time
- Suggest improvements to make challenges more educational
- When ready, generate a complete challenge specification`;
```

### Authoring Flow
1. **Clarification phase**: Gather requirements through conversation
2. **Generation phase**: Create structured challenge when sufficient context
3. **Validation phase**: Ensure challenge is coherent and achievable

### Challenge Generation Format
When generating a challenge, return a structured JSON object:
```typescript
interface GeneratedChallenge {
  title: string;          // Concise, descriptive title
  description: string;    // Full requirements with examples
  language: string;       // Target programming language
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;  // e.g., "30 minutes"
  whyThisChallenge: string[]; // Learning benefits
}
```

### Templates
Quick-start templates provide context for common challenge types:
- Algorithm challenges
- Testing practice
- Refactoring exercises
- Data manipulation
- API integration
- Performance optimization

## Environment Variables

See [`.env.example`](../.env.example) for the canonical list. Highlights:

```bash
# Auth.js v5 + GitHub App (REQUIRED in every environment)
AUTH_SECRET=                  # openssl rand -base64 32
AUTH_GITHUB_ID=               # GitHub App client id
AUTH_GITHUB_SECRET=           # GitHub App client secret
AUTH_TRUST_HOST=true          # required behind a proxy (ACA, Codespaces, etc.)

# Per-user abuse controls (defaults match in-code values)
AUDIT_SALT=                   # openssl rand -hex 32
# RATE_LIMIT_CHAT_PER_MIN=30
# RATE_LIMIT_CHAT_CAP=3
```

## Commands

```bash
# Development
npm run dev           # Start dev server at localhost:3000
npm run build         # Production build
npm run lint          # Lint code

# Testing
npm test              # All tests (non-interactive: vitest run)
npm run test:watch    # Watch mode for TDD
npm run test:coverage # Coverage report

# Tech Debt Analysis
npm run debt:check    # Run all tech debt checks
npm run debt:unused   # Find unused files, exports, deps (knip)
npm run debt:exports  # Find unused TypeScript exports (ts-prune)
npm run debt:deps     # Find unused dependencies (depcheck)
npm run debt:circular # Find circular dependencies (madge)
```

## Tech Debt Tools

Use `/analyze-tech-debt` prompt for comprehensive analysis. Available commands:

| Tool | Command | Purpose | When to Run |
|------|---------|---------|-------------|
| **knip** | `npm run debt:unused` | Unused files, exports, dependencies | Before major refactor, monthly |
| **ts-prune** | `npm run debt:exports` | Unused TypeScript exports | PR review, before release |
| **depcheck** | `npm run debt:deps` | Unused npm dependencies | Monthly, after dep updates |
| **madge** | `npm run debt:circular` | Circular dependencies | Architecture changes |
| **All** | `npm run debt:check` | Run all checks at once | Quarterly cleanup |

**Integration**: Use `review-code` prompt with `mode=debt` for guided analysis.

## Code quality contract

Three skills enforce non-negotiable standards on every change. Invoke them
proactively — they are not optional:

- **[`readable-code`](.github/skills/readable-code/SKILL.md)** — *Apply when writing or refactoring TS/TSX.* The bar: a reader who has never seen this codebase before should understand any file from names alone. Rules cover descriptive naming (no `data`/`result`/`x`), plain control flow (no nested ternaries or bitwise tricks), and comments that explain **why** not **what**. Hard rule: TSDoc lines ≤ function body lines. The authoritative rules sit in [`typescript.instructions.md`](.github/instructions/typescript.instructions.md) and [`documentation.instructions.md`](.github/instructions/documentation.instructions.md); the skill is the practical companion.

- **[`panel-review`](.github/skills/panel-review/SKILL.md)** — *Mandatory for any non-trivial architectural change.* Convenes a six-reviewer panel (three models × architect + developer personas) that critiques the plan before code lands and re-reviews every milestone until consensus. Every finding of every severity fix-forwards in the next round; the loop exits only when 6/6 SHIP with zero findings. Use the panel for multi-file refactors, cross-cutting cleanups, performance work, or any change where "wrong design" costs more than "wrong implementation".

- **[`doc-currency`](.github/skills/doc-currency/SKILL.md)** — *Mandatory before `task_complete` for any non-trivial change.* Maps the area you touched to its authoritative docs (OTel skill, multi-tenant arch doc, copilot-instructions, README, …) and updates the specifics that drifted. Doc updates ship in the same commit as the code, never as a follow-up PR.


