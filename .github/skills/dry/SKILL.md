# DRY Skill

## Overview

DRY — **Don't Repeat Yourself** — is one of the most misquoted principles in software engineering. It is *not* a rule about avoiding repeated lines of code. It is a rule about avoiding repeated **knowledge**.

Andy Hunt and Dave Thomas defined it in *The Pragmatic Programmer*:

> Every piece of knowledge must have a single, unambiguous, authoritative representation within a system.

The unit DRY cares about is a *decision* — a business rule, an algorithm, a wire format, a magic constant, a security policy. When the same decision is encoded in two places, the system has two sources of truth that will inevitably drift. Two lines that happen to look the same but encode unrelated decisions are *not* a DRY violation.

A useful test: **if this decision changed, how many files would I need to edit?** If the answer is "more than one," you have duplicated knowledge.

## Authoritative reference

The full set of TypeScript style and architectural rules for this repository lives in [`.github/instructions/typescript.instructions.md`](../../instructions/typescript.instructions.md). That file is the single source of truth for naming, imports, error handling, and abstraction boundaries. This skill is a practical lens; it does not redefine the rules.

## DRY vs WET vs AHA

| Acronym | Stands for | Meaning |
| --- | --- | --- |
| **DRY** | Don't Repeat Yourself | Each piece of *knowledge* has one authoritative home. |
| **WET** | Write Everything Twice / We Enjoy Typing | Tolerated, sometimes preferred, when an abstraction would couple unrelated callers. |
| **AHA** | Avoid Hasty Abstractions | Wait until the duplication tells you what the abstraction wants to be. Coined by Kent C. Dodds. |

The classic heuristic is the **rule of three**: don't extract an abstraction on the second occurrence — wait for the third. By then you can see what is genuinely shared (the knowledge) and what only looks the same (coincidental shape). Premature abstraction locks in the wrong axis of variation and is usually more painful to undo than the duplication it was meant to eliminate.

DRY is about *knowledge*. AHA is about *timing*. They are complementary, not competing.

## Where DRY shines in this codebase

These are three places where extracting the authoritative representation paid off — change the decision once, every caller updates automatically.

### 1. API response helpers — `src/lib/api/response-utils.ts`

Every API route returns the same envelope shape: `{ success, data?, error?, meta? }`. The shape is defined exactly once:

```ts
// src/lib/api/response-utils.ts
export function apiSuccess<T>(
  data: T,
  meta?: Record<string, unknown>
): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json({
    success: true,
    data,
    ...(meta && { meta }),
  });
}

export function validationErrorResponse(
  message: string,
  meta?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return apiError(message, meta, 400);
}

export function serviceUnavailableResponse(
  message: string,
  meta?: Record<string, unknown>
): NextResponse<ApiErrorResponse> {
  return apiError(message, meta, 503);
}
```

The knowledge being centralised is "what does a Flight School API response look like on the wire?" Changing the envelope (e.g. adding a `requestId`) is a one-file edit. Without these helpers, the same `NextResponse.json({ success: false, error: ... })` literal would appear in every route file — and one of them would inevitably forget to set `status: 400`.

### 2. `withUserGuards` composition — `src/lib/security/guard.ts`

Rate limiting, concurrent-session caps, and audit logging are each defined in their own modules — but the **order in which they apply to an expensive API route** is itself a piece of knowledge, and it lives in exactly one place:

```ts
// src/lib/security/guard.ts
export async function withUserGuards<T>(
  opts: GuardOptions,
  work: (ctx: UserContext) => Promise<T>,
): Promise<T> {
  const ctx = await requireUserContext();
  const userIdHash = hashUserId(ctx.userId);

  if (opts.rateLimit) {
    const { allowed, retryAfterMs } = checkRateLimit(
      ctx.userId,
      opts.rateLimit.limit,
      opts.rateLimit.windowMs,
    );
    if (!allowed) {
      auditLog({ type: 'rate-limit.blocked', userIdHash, /* ... */ });
      throw new RateLimitedError(retryAfterMs ?? opts.rateLimit.windowMs);
    }
  }

  // acquire concurrent-session slot, audit, run work, release...
}
```

Without this, every AI-backed route would re-implement the auth → rate-limit → cap → audit pipeline. With it, adding (say) a new audit field is a single edit and every route gets it. The decision "what does *protected* mean for this app?" has one home.

### 3. `createSSEResponse` — `src/lib/api/streaming-utils.ts`

The SSE wire format is exactly one decision: header set, `data: <json>\n\n` framing, `[DONE]` terminator, error event shape. One file owns it; every streaming route consumes it.

```ts
// src/lib/api/streaming-utils.ts
const SSE_HEADERS: HeadersInit = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Transfer-Encoding': 'chunked',
};

export function createSSEResponse<T extends SSEStreamEvent, /* ... */>(
  streamGenerator: () => AsyncGenerator<T, void, undefined>,
  options?: CreateSSEResponseOptions<TMeta>
): Response {
  // ...encode each event as `data: ${JSON.stringify(event)}\n\n`
  // ...emit `data: [DONE]\n\n` when the generator finishes
  // ...emit `{ type: 'error', message }` on throw
}
```

If a future client requires named SSE events (`event: token\n`), there is precisely one function to update and zero routes to audit.

## Where DRY went WRONG in this codebase (and was fixed)

Not every "shared thing" is shared knowledge. The clearest cautionary tale in this repo is the **old singleton Octokit** in `src/lib/github/client.ts`.

A single process-wide `Octokit` instance *looks* like DRY: one client, configured once, reused everywhere. But the knowledge being represented — *which user's token authorises this request* — is **per-request**, not per-process. Sharing a singleton across users collapsed two different decisions into one and leaked tokens and rate-limit budgets between sessions.

The fix is captured in the module's own docstring today:

```ts
// src/lib/github/client.ts
/**
 * Per-request Octokit factory. Each authenticated request constructs its
 * own Octokit instance bound to the session's GitHub App user-to-server
 * token (resolved by `@/lib/auth/context`). There is intentionally NO
 * singleton — sharing Octokit instances across users would leak tokens
 * and rate-limit budgets between sessions.
 */

export async function getOctokitForRequest(): Promise<Octokit> {
  const { accessToken } = await requireUserContext();
  return getOctokitForToken(accessToken);
}
```

The instrumentation (OpenTelemetry hook setup) is *still* DRY — it lives in `instrumentOctokitRequests` and runs against every freshly constructed instance. What changed is that "the request authorisation" went back to being per-request knowledge, where it belongs. That is DRY done right: deduplicate the cross-cutting wiring, not the user-scoped state.

Lesson: **shared instances and shared knowledge are not the same thing.** When the lifetime of the data doesn't match the lifetime of the supposed abstraction, the abstraction is wrong.

## Spotting accidental duplication

Before reaching for an extraction, walk the checklist. If two or more of these are true, you probably have duplicated knowledge worth consolidating:

- **The same magic string appears in multiple files** — header names, env-var keys, audit event types, model identifiers, route paths. If `'x-ratelimit-remaining'` shows up in three files, it's a constant in disguise.
- **The same `if (response.ok)` / `if (!res.ok) throw ...` boilerplate is repeated** around `fetch` or Octokit calls. The error-shape decision is being re-encoded each time.
- **The same env-var lookup logic is repeated** — `process.env.FOO ?? process.env.FOO_FALLBACK ?? throwSomething()`. That fallback ordering *is* the knowledge; centralise it. (For request-scoped GitHub auth in this repo, that knowledge lives in `requireUserContext()` in `src/lib/auth/context.ts` — every route that needs a user token goes through it.)
- **The same shape of try/catch + log + rethrow** appears around external calls — that is a cross-cutting concern (telemetry, audit, error mapping) waiting to be wrapped.
- **The same JSON envelope** is constructed by hand instead of going through `apiSuccess` / `validationErrorResponse` / `serviceUnavailableResponse`.
- **The same SSE framing** (`data: ${JSON.stringify(...)}\n\n`) is built by hand instead of going through `createSSEResponse`.

Any of these is a strong signal that an authoritative representation already exists (or should) and the duplicated call sites should be migrated to it.

## When DRY is wrong

Duplication is sometimes the right call. Reach for it — knowingly — when:

- **The two call sites encode unrelated decisions that happen to look the same today.** Coupling them via a shared helper means the next change to one will be forced through the other, and the abstraction will sprout boolean flags.
- **The shared abstraction would need so many parameters that the call sites become harder to read than the duplication.** If `doThing(true, false, undefined, 'compact', { trim: true })` is your "DRY" version, the duplicate `if`/`else` was clearer.
- **You're on the second occurrence and the third hasn't appeared yet.** Rule of three. Wait. The third occurrence will tell you which axis actually varies.
- **The cost of getting the abstraction wrong outweighs the cost of editing two files later.** Public APIs, wire formats, and cross-package contracts have very high abstraction-cost; local helpers have very low duplication-cost.
- **The two snippets live on different sides of an architectural seam** (e.g. one in a server route, one in a client component). Coupling across the seam is more expensive than the duplication.

Sandi Metz puts it bluntly: *duplication is far cheaper than the wrong abstraction*. When in doubt, duplicate, observe, and extract later — once the shape of the knowledge is clear.

## See also

- [`.github/skills/solid/SKILL.md`](../solid/SKILL.md) — companion skill on SOLID principles; DRY and SRP are close cousins (one reason to change → one place to change it).
- [`.github/instructions/typescript.instructions.md`](../../instructions/typescript.instructions.md) — authoritative TypeScript style and architecture rules for this codebase.
- [`.github/skills/copilot-sdk/SKILL.md`](../copilot-sdk/SKILL.md) — how the Copilot SDK is integrated; many of the wrappers in `src/lib/copilot/` exist precisely to keep SDK knowledge DRY.
