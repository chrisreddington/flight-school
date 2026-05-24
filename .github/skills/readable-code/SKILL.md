---
name: readable-code
description: |
  Use whenever you are writing, reviewing, or refactoring TypeScript/TSX
  in this repo. Enforces the project's readability contract: self-documenting
  names, plain control flow, and comments that explain *why* not *what*.
  Trigger phrases: "clean this up", "make this readable", "refactor", "name
  this better", "is this code clear?", "review my code".
---

# Readable Code skill

> A reader who has **never seen this codebase before** should be able to open
> any file and understand what it does without external context.
> That is the bar. Everything in this skill exists to defend it.

This skill is the practical companion to the readability rules. The
authoritative rules live in:

- [`.github/instructions/typescript.instructions.md`](../../instructions/typescript.instructions.md) — naming, anti-patterns, validation gates.
- [`.github/instructions/documentation.instructions.md`](../../instructions/documentation.instructions.md) — TSDoc proportionality, inline-comment standards.

This file is the **how to apply them** layer.

## The four rules

### Rule 1 — Names carry the meaning

The variable, function, and type name must tell you what it is **without
reading the implementation**. If you have to scan three lines to figure out
what `data` holds, the name is wrong.

```typescript
// ❌ Generic names force readers to trace data flow
const data = await fetch(url).then(r => r.json());
const result = data.items.filter(i => i.x > 0);

// ✅ Names answer "what is this?"
const profileResponse = await fetch(url).then(r => r.json());
const activeRepositories = profileResponse.repositories.filter(
  repo => repo.stargazerCount > 0,
);
```

**Specific rules:**

- No single-letter variables except loop indices in trivial loops (`for (let i = 0; …)`). Even then, prefer `for (const repo of repos)`.
- No `data`, `result`, `info`, `tmp`, `x`, `obj`, `arr` as standalone identifiers. Add the noun: `profileData`, `parseResult`, `userInfo`.
- Booleans read as questions: `isAuthenticated`, `hasFocusForToday`, `shouldRetry`. Not `auth`, `focus`, `retry`.
- Functions read as verbs: `fetchProfile`, `loadFocusForUser`, `serializeForCache`. Not `profile`, `focus`, `cache`.
- Async functions that return a Promise of T are still named for T, not "thingify": `getUserContext()` not `userContextify()`.
- Units in the name when relevant: `timeoutMs`, `intervalSeconds`, `maxBytes`. Never just `timeout`.
- Type aliases describe a value's role, not its shape: `UserId` not `StringId`, `RepositoryHandle` not `OwnerRepoTuple`.

### Rule 2 — Plain control flow beats clever expressions

Cleverness asks the reader to derive what the code does. Plain code tells
them. We optimise for the reader, not the writer.

```typescript
// ❌ "Clever" — three operators, two implicit conversions, one ternary
const stars = repos?.reduce((a, b) => a + (b?.stars ?? 0), 0) || 0;

// ✅ Plain — every line says exactly what it does
let totalStars = 0;
for (const repo of repos ?? []) {
  totalStars += repo.stars ?? 0;
}
return totalStars;
```

**Specific rules:**

- No nested ternaries. One level is fine; two is a refactor.
- No bitwise tricks (`x | 0`, `~~x`, `x & 1`) unless you're talking to hardware. Use `Math.trunc`, `x % 2 === 0`, etc.
- Don't lean on `&&` / `||` for control flow when an `if` would read clearer. `user && setState(user)` becomes `if (user) setState(user)`.
- Avoid "point-free" callback chains where the data being threaded is invisible. Name the parameter.
- Prefer early returns over deep nesting. Three levels of indentation is a code smell.
- Don't write a one-liner that takes 30 seconds to parse. Two boring lines beat one impressive line.

### Rule 3 — Comments explain *why*, not *what*

If a comment restates the code, delete it and rename the variable. Comments
exist to preserve **context the code itself cannot carry**: invariants,
rationale, links to issues, browser quirks, gotchas discovered the hard way.

```typescript
// ❌ Restates the code — adds zero value
// Increment retry count
retryCount++;

// ❌ Could be a better name instead
// True when user is over the rate limit
const flag = requests > limit;

// ✅ Explains a non-obvious invariant
// NOTE: BatchSpanProcessor only exports ENDED spans, so we must
//       call .end() on pagehide or the last batch is silently dropped.
window.addEventListener('pagehide', () => currentSpan?.end());
```

**Inline-comment proportionality** (mirrors the TSDoc rule):
- One-line block (under 5 LOC) → ≤1 line of comment, only if non-obvious.
- 5–20 LOC → up to 2–3 line comment block at the top explaining intent.
- 20+ LOC → break the function up first; if you can't, a `@remarks` TSDoc block is the right home, not a wall of `//` comments.

**Use the standard prefixes** (`// NOTE:`, `// PERF:`, `// CRITICAL:`,
`// TODO:`, `// FIXME:`) — defined in
`documentation.instructions.md`. They make `grep` reliable.

### Rule 4 — TSDoc is for boundaries, not internals

TSDoc earns its keep at module boundaries — exported functions, public
types, route handlers. Internal helpers get a one-line TSDoc at most,
and often nothing if the signature speaks for itself.

The proportionality table from `documentation.instructions.md` is binding:

| Function size | TSDoc budget |
| --- | --- |
| ≤10 LOC | Summary + required tags only (≤3 lines) |
| 11–30 LOC | Summary + all applicable tags (≤6 lines) |
| >30 LOC | Full documentation as needed |

> **Hard rule:** TSDoc line count must not exceed function body line count.

If your TSDoc is longer than the code, either the code is wrong (needs
breaking up) or the TSDoc is wrong (probably narrating what instead of
explaining why).

## When to invoke this skill

- Before writing new business logic — frame your names first.
- During PR review when you're tempted to leave a `nit:` comment about naming.
- When a file makes you slow down on read. That's the trigger. Refactor for the next reader.
- After getting a rubber-duck critique that mentions "I had to read this twice".

## Self-review checklist

Before declaring code complete:

- [ ] Can a new reader understand each function from its **name and signature**?
- [ ] Are there any one-letter or generic names (`data`, `result`, `obj`)?
- [ ] Are there any nested ternaries, bitwise tricks, or `&&`-as-`if` chains?
- [ ] Does any comment restate the code? Delete or rename.
- [ ] Is any TSDoc block longer than the function it documents? Trim.
- [ ] Could any boolean be renamed to a question (`isX`, `hasY`, `shouldZ`)?
- [ ] Does any duration variable lack a unit suffix (`Ms`, `Seconds`)?
- [ ] Is the longest function under ~30 LOC? If not, can it be split?

If you cannot tick every box, the code is not ready.

## What this skill is not

- It is **not** a style guide for whitespace or quote marks — Prettier handles that.
- It is **not** a license to bikeshed names — pick the clearest one, ship, move on.
- It is **not** an excuse to rewrite working code you didn't otherwise need to touch. Apply this skill to code you're already changing.
