# TSDocs Skill

## Overview

This skill is the practical companion to the project's TSDoc rules. It shows what good TSDoc looks like in *this* codebase, points at real files to mine for patterns, and calls out common gaps so you can fix them when you touch a file.

**TSDoc vs JSDoc.** TSDoc is a documentation comment standard maintained by Microsoft, designed specifically for TypeScript. JSDoc predates it and was built for JavaScript — its tags often double as type annotations (`@param {string}`), which is redundant when the language already has types. TSDoc drops type-in-comment annotations and standardizes the tag grammar so tools (API Extractor, VS Code, ESLint plugins) parse the same comments the same way. **This project uses TSDoc** so editor hovers, future generated docs, and lint rules all agree.

**Why TSDoc matters here.** It powers three concrete things:

1. **Editor hovers** — every `@param`, `@returns`, `@throws` you write shows up when a teammate hovers over the call site in VS Code.
2. **Generated docs** — if/when we publish API reference pages, TSDoc is what gets extracted.
3. **Reviewer attention** — a missing `@throws` is the single most common reason a caller forgets to handle an error.

## Authoritative reference

The canonical TSDoc rules for this repo live in **[`.github/instructions/documentation.instructions.md`](../../instructions/documentation.instructions.md)** — explicitly marked `SINGLE SOURCE OF TRUTH`. This skill **defers to that file for any conflict**. If something here disagrees with the instructions file, the instructions file wins and this skill should be updated.

In particular, the instructions file owns:

- The **proportionality rule** (TSDoc lines ≤ function body lines).
- The right-sizing table (≤10 LOC / 11–30 LOC / >30 LOC).
- The canonical **TSDoc Tags Reference** (when to include `@param`, `@returns`, `@throws`, `@example`, `@remarks`, `@see`, `@internal`, `@public`, `@deprecated`).
- Inline comment prefix conventions (`// PERF:`, `// NOTE:`, `// CRITICAL:`, `// TODO:`, `// FIXME:`).
- The anti-pattern catalogue.

Read it first. This file is examples.

## Anatomy of a good TSDoc comment in this repo

A clean, working example: `requireUserContext()` in [`src/lib/auth/context.ts`](../../../src/lib/auth/context.ts):

```typescript
/**
 * Like {@link getUserContext} but throws {@link UnauthorizedError} when the
 * request is unauthenticated. Use this inside API route handlers.
 */
export async function requireUserContext(): Promise<UserContext> {
  const ctx = await getUserContext();
  if (!ctx) throw new UnauthorizedError();
  return ctx;
}
```

What this gets right:

- **Proportional.** Two lines of prose for a three-line function — the instructions file's hard rule (TSDoc lines ≤ body lines) is satisfied.
- **Intent, not mechanics.** It says *what calling this means for you* ("throws when unauthenticated, use in API routes"), not "calls `getUserContext` and checks if null".
- **`{@link}` cross-refs** to related symbols so hover docs are navigable.
- **No `@param` / `@returns`** — there are no params, and the return type `Promise<UserContext>` is self-documenting. The instructions file explicitly allows skipping these when the signature speaks for itself.
- **No `@throws` placeholder.** It mentions `UnauthorizedError` in prose via `{@link}` — for a two-line summary that's enough. (For richer surfaces, see `withUserGuards` below.)

A longer, fully-tagged example: `withUserGuards()` in [`src/lib/security/guard.ts`](../../../src/lib/security/guard.ts):

```typescript
/**
 * Apply auth + rate-limit + concurrent-cap + audit logging around `work`.
 *
 * @throws {@link RateLimitedError} when the user is over the rate limit.
 * @throws {@link TooManyConcurrentSessionsError} when the user is over the
 *   concurrent-session cap.
 * @throws {@link UnauthorizedError} when the request is unauthenticated.
 */
export async function withUserGuards<T>(
  opts: GuardOptions,
  work: (ctx: UserContext) => Promise<T>,
): Promise<T> {
```

This pattern — one-line summary + a `@throws` per failure mode + an `@example` block at the file or symbol level — is the right shape for any exported function that can throw. Note the file-level `@example` directly above the export shows the canonical call site for reviewers, without bloating each function's own comment.

## Required tags by export kind

The canonical rules are in [`documentation.instructions.md` § TSDoc Tags Reference](../../instructions/documentation.instructions.md). Quoting the operative line:

> | `@param` | **Always** for all parameters | Parameter name is self-documenting AND ≤10 LOC function |
> | `@returns` | Non-void functions | Return type is obvious (e.g., `getName(): string`) |
> | `@throws` | Function can throw | Function never throws |

Practical translation by export kind:

| Export kind | Summary | `@param` | `@returns` | `@throws` | `@example` | `@deprecated` |
|---|---|---|---|---|---|---|
| **Exported function** | Required | Yes, unless self-documenting & ≤10 LOC | Yes, unless return type is obvious | One per throwable error | For non-obvious APIs / public surface | Only if phasing out (include migration path) |
| **Exported class** | Required (one summary on the class) | On the constructor and each public method | On each non-void method | Per throwable method | On the class for canonical usage | If the class is being removed |
| **Exported interface** | Required | TSDoc each field (one-liner is fine) | n/a | n/a | If the shape is non-obvious | Per-field if individual fields are being removed |
| **Exported type alias** | Single-line TSDoc is usually enough | n/a | n/a | n/a | Only for non-obvious unions/discriminants | Rare |
| **Exported constant** | Single-line TSDoc explaining intent / units | n/a | n/a | n/a | If usage is non-obvious | Rare |

Defer to the instructions file's right-sizing table for *how much* prose. The table above only covers *which tags* — length is a separate axis.

### Interface field documentation

The codebase already does this well. From `src/lib/security/rate-limit.ts`:

```typescript
export interface RateLimitResult {
  /** Whether the request is allowed under the current window. */
  allowed: boolean;
  /** Milliseconds the caller should wait before retrying. Only present when blocked. */
  retryAfterMs?: number;
}
```

One-line TSDoc per field. The optional `retryAfterMs` mentions *when it's present* — that's the kind of intent-over-mechanics detail that's worth the line.

## What NOT to document

Don't write TSDoc that:

1. **Restates the type.** `@param userId - The user id, a string.` adds nothing the signature didn't already say. Write *what role the value plays*, not its type.
2. **Narrates the implementation.** `// Loop through buckets and filter expired entries` is what the code itself shows. The instructions file's anti-pattern table calls this out explicitly.
3. **Lists obvious behaviour.** `getUserById(id: string): User | null` does not need "Returns the user with the given id, or null if not found." That's the signature in prose.
4. **Is a placeholder.** `TODO: write docs` is worse than nothing — it signals to readers "stop reading, this is unfinished." Either write it or omit the comment.
5. **Documents private helpers.** Internal helpers (`cleanupExpired` in `rate-limit.ts`) don't need TSDoc — a brief inline `// NOTE:` is enough when intent isn't obvious. Mark testing-only exports with `@internal` (see `__resetRateLimitState`).

## Examples of well-documented exports in this codebase

Three real exports worth mining when you write or review TSDoc. Each
shows a different right-sized shape, from one-liner field docs through
to fully-tagged thrower contracts. (These were rough spots earlier in
the project's life; H5 brought them up to standard. They are now the
benchmark, not the cautionary tale.)

### 1. `src/lib/auth/token-store.ts` — `TokenStore` interface methods

Every method on the `TokenStore` contract documents its **edge-case
behaviour**, because the contract is the Liskov boundary between the
in-memory and Cosmos implementations. Notice how each method explains
the *observable* corners — what "not found" looks like, whether the
operation is idempotent — rather than restating the signature:

```typescript
export interface TokenStore {
  /**
   * Look up the stored token for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @returns The {@link StoredToken}, or `null` when no record exists for
   *   the user **or** when the stored record has already expired
   *   (`expiresAt * 1000 <= now`). Callers must treat "not found" and
   *   "expired" identically — both mean "refresh / re-auth required".
   *   Never throws for missing users.
   */
  getToken(userId: string): Promise<StoredToken | null>;

  /**
   * Persist `token` for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @param token - The token payload to store. Overwrites (upserts) any
   *   previous record for the same `userId`; there is no separate update
   *   path.
   */
  setToken(userId: string, token: StoredToken): Promise<void>;

  /**
   * Remove the token record for `userId`.
   *
   * @param userId - Stable GitHub numeric ID as a string.
   * @remarks Idempotent: deleting a `userId` with no stored token is a
   *   successful no-op, not an error.
   */
  deleteToken(userId: string): Promise<void>;
}
```

What this gets right: every "what does the caller do with the return
value?" question is answered at the contract level, not deferred to
"see the implementation".

### 2. `src/lib/security/rate-limit.ts` — `checkRateLimit`

This function is a good template for "function with both a return value
*and* a side effect". The `@returns` tag describes both arms of the
discriminated result, and the prose calls out the side effect explicitly
so callers know that *asking is also recording*:

```typescript
/**
 * Check whether a user may make another request inside the sliding window.
 * Records the timestamp when allowed; the next call sees this request in
 * its window.
 *
 * @param userId - Stable user identifier (e.g. GitHub numeric ID).
 * @param limit - Max number of requests permitted within `windowMs`.
 * @param windowMs - Length of the sliding window in milliseconds.
 * @returns A {@link RateLimitResult}: `allowed: true` when the request fits
 *   in the window (and the timestamp has been recorded), or
 *   `allowed: false` with `retryAfterMs` indicating how long the caller
 *   must wait before the oldest in-window request ages out.
 */
export function checkRateLimit(
  userId: string,
  limit: number,
  windowMs: number,
): RateLimitResult { /* ... */ }
```

### 3. `src/lib/security/session-cap.ts` — `acquireSlot`

When a function returns a callback (release, dispose, unsubscribe), the
`@returns` tag is the *most important* part of the comment — it tells
the caller what their cleanup obligation is. `acquireSlot` makes that
contract structural rather than buried in prose:

```typescript
/**
 * Acquire a concurrency slot for `userId`.
 *
 * @param userId - Stable user identifier.
 * @param max - Maximum simultaneous slots permitted for the user.
 * @returns A release function. Call it (typically in a `finally` block)
 *   exactly once when the work completes; subsequent calls are no-ops.
 * @throws {@link TooManyConcurrentSessionsError} when the user already
 *   holds `max` slots.
 */
export async function acquireSlot(
  userId: string,
  max: number,
): Promise<() => void> { /* ... */ }
```

Two reusable patterns to copy: pair every throwable function with a
`@throws {@link ErrorClass}` tag (the linked class makes the error
discoverable from the hover), and when the return value carries a
cleanup obligation, say so in `@returns` — not in a trailing remark
the reader might skim past.

## Verifying TSDoc quality

There is **no automated TSDoc validator** wired up in this repo today. Specifically:

- `npx tsc --noEmit` checks types, not TSDoc. A nonsense `@param` name will compile fine.
- `npm run lint` (eslint) does not currently include a TSDoc plugin.
- There is no `tsdoc-validator` in `package.json` — don't assume it runs.

Practical verification today:

1. **Hover in VS Code.** The most reliable check. Open the file, hover over the symbol at a call site, and read the popup as if you'd never seen the function before. If anything is wrong, missing, or confusing — fix it. This catches stale `@param` names, missing `@returns`, and bad `{@link}` targets immediately.
2. **Cross-check `@param` names against the signature.** Stale `@param` names are the most common rot. After any signature change, re-read the comment.
3. **Re-read after refactor.** When you change behaviour, the existing TSDoc is the first thing that goes stale.
4. **Review.** Reviewers should treat missing `@throws` on a throwable function as a blocker; everything else is style.

If we add `eslint-plugin-tsdoc` or `api-extractor` later, this section gets updated to reference them.

## See also

- **[`.github/instructions/documentation.instructions.md`](../../instructions/documentation.instructions.md)** — canonical rules; this skill defers to it.
- **[`.github/skills/solid/SKILL.md`](../solid/SKILL.md)** — SOLID principles companion skill (sibling to this one).
- **[`.github/instructions/typescript.instructions.md`](../../instructions/typescript.instructions.md)** — TypeScript coding standards (DRY, clarity, lint rules) that complement TSDoc conventions.
