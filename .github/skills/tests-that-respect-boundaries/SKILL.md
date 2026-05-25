---
description: Use whenever you are writing, reviewing, or refactoring tests in this repo. Enforces the project's contract that tests assert observable behaviour, mock only at system seams, stay small and table-driven, and never drift into "did the mock get called" territory. Trigger phrases: "write tests for", "add a test", "fix this test", "are these tests testing the right thing?", "review my tests".
---

# Tests that respect boundaries

## Why this skill exists

In this repo, tests are starting to drift past their own boundaries: hook tests that assert on `expect(mocks.someStore).toHaveBeenCalledWith(...)` instead of asserting on `result.current`; storage tests that re-verify what the persistence layer already proves; multi-hundred-line files that prove the same behaviour six different ways. Each one of those is a test that locks in the *implementation* — so harmless refactors break tests and the suite stops being a safety net and starts being a tax.

This skill is the practical contract: **one module, one test file, observable assertions, system-seam mocks, table-driven cases, hard size caps**. It supplements the rules in [`.github/instructions/testing.instructions.md`](../../instructions/testing.instructions.md) and the TDD discipline in [`tdd/SKILL.md`](../tdd/SKILL.md) — it does not replace them.

## The contract

### 1. Test the unit, not the mock

A test must assert on the **public output of the unit under test** — the function's return value, the state observable through a hook's `result.current`, the body of a `NextResponse`, the rendered DOM, the audit-log entry written, or the typed error thrown. It must not assert on whether one of the unit's collaborators received a particular call.

**Bad — testing the mock:**

```ts
it('saves the focus item', async () => {
  await saveFocusItem(item);
  expect(mocks.focusStore.put).toHaveBeenCalledWith(item); // tests the wiring, not the behaviour
});
```

**Good — testing the behaviour:**

```ts
it('saves the focus item', async () => {
  await saveFocusItem(item);
  const stored = await getFocusItem(item.id);
  expect(stored).toEqual(item);
});
```

The "good" version survives every reasonable refactor of `saveFocusItem` — change the storage call, batch it, retry it, swap the underlying client — as long as the *behaviour* "after saving, you can read it back" still holds.

### 2. Mock only at system seams

You may mock:

- `fetch` (configured globally in `src/test/setup.ts`)
- the filesystem (`node:fs`)
- timers (`vi.useFakeTimers()`)
- env (`vi.stubEnv`)
- third-party SDK boundaries we don't own (`@github/copilot-sdk`, `octokit`, `next-auth/jwt`, `@azure/*`)
- network/SSE infrastructure (`EventSource`, the worker dispatch client)

You may **not** mock:

- our own application modules (`@/lib/focus/*`, `@/lib/storage/*`, `@/hooks/*`)
- pure functions or builders we wrote
- presentation components we wrote
- `requireUserContext` *unless* the test is specifically pinning auth-failure paths — in which case use `vi.mocked(requireUserContext).mockRejectedValueOnce(new UnauthorizedError())` and assert on the resulting response, not on the mock

If you find yourself reaching for `vi.mock('@/lib/<our-own-module>')` to make a test pass, the design is wrong: the unit under test has too many collaborators, or the wrong collaborators. Split it before you mock it.

### 3. Hook tests use `renderHook` + assertions on `result.current`

Hooks own state and effects. The system-under-test is the **hook's externally observable behaviour** — its returned values, the timing of its effects, the way it responds to dependencies changing. That is exactly what `renderHook` exposes:

```ts
import { renderHook, act } from '@testing-library/react';

it('reflects the current loading and data state', async () => {
  const { result } = renderHook(() => useFocusItems());

  expect(result.current.loading).toBe(true);
  await act(async () => {});
  expect(result.current.loading).toBe(false);
  expect(result.current.items).toHaveLength(2);
});
```

Hook tests should never use `expect(mockedFunction).toHaveBeenCalledWith(...)`. The hook's contract is `result.current`, not "did I forward the call". If you need to verify wiring at all (you usually don't), do it at the system seam — assert on `fetch.mock.calls`, not on a mocked-out application module.

### 4. Table-driven (`it.each`) for ≥ 4 similar cases

If you find yourself writing four near-identical `it()` blocks that differ only in inputs and expected output, collapse them with `it.each`:

```ts
it.each([
  ['empty', '',          { ok: false, code: 'empty' }],
  ['too short', 'ab',    { ok: false, code: 'too-short' }],
  ['valid', 'abcd',      { ok: true } ],
  ['too long', 'a'.repeat(257), { ok: false, code: 'too-long' }],
])('parses %s input', (_, input, expected) => {
  expect(parseName(input)).toEqual(expected);
});
```

Two or three cases? Keep them as separate `it()` blocks for clarity. Four or more? Use `it.each`. The bar is concrete: at the fourth near-duplicate, your reviewer can demand the table.

### 5. One module, one test file

Each `*.test.ts` file tests **one production module**. If your test file imports two source modules and asserts on both, you are writing a test that will break when either one refactors — and you've made the failure harder to diagnose. Split the file along its imports.

Exception: integration tests under `src/test/integration/` exist specifically to assert on cross-module invariants (multi-tenant isolation, end-to-end auth flow). Those are allowlisted by path.

### 6. Per-file size budget — 400 LOC

If a test file exceeds 400 lines, it is testing too much. Either:

- the production module under test is doing too much (split it, write `.test.ts` files per piece); or
- the test file has redundant cases that aren't behaviourally distinct (collapse with `it.each` or delete the duplicates).

CI rejects new violations (see *Enforcement* below).

### 7. Tenant boundary assertions are required for guarded routes and per-user storage

Anywhere the production code calls `requireUserContext()`, `withUserGuards()`, or writes per-user data, the test file must include at least one assertion that fails if the tenant boundary breaks. Concrete examples:

```ts
it('returns 401 when no session is present', async () => {
  vi.mocked(requireUserContext).mockRejectedValueOnce(new UnauthorizedError());
  const response = await GET(buildRequest('/api/quiz'));
  expect(response.status).toBe(401);
});

it('does not leak userA data into userB requests', async () => {
  await saveFocusItemAs('user-a', { id: '1', topic: 'rust' });
  const items = await listFocusItemsAs('user-b');
  expect(items).toEqual([]);
});
```

The leak test must be **deliberately breakable** — if you delete the isolation logic in the production code, this test must go red. If it can't, it isn't asserting tenant isolation.

### 8. Stop rule — no new test if it doesn't change a public-behaviour assertion

Before writing a new `it()`, answer: *what observable behaviour does this test pin that no existing test pins?* If you can't answer concretely, delete the test. Test count is not a metric. Lines locked-in are not a metric. **Distinct behaviours pinned** is the only metric.

## Patterns

### Canonical exemplar — `request-validators.test.ts`

The exemplar pattern for this repo is [`src/lib/api/request-validators.test.ts`](../../../src/lib/api/request-validators.test.ts). It hits every rule on this list: small file, observable assertions, table-driven cases, zero application-layer mocks, one module under test. When in doubt, copy that shape.

### Leak tests — see TDD skill

Cross-user / cross-tenant assertion patterns are documented in [`tdd/SKILL.md`](../tdd/SKILL.md#leak-tests--crossusercrosstenant-assertions). Don't duplicate them here; reuse the conventions.

### Hook tests with `renderHook` + `act`

The canonical hook-test exemplar is `src/hooks/use-threads.test.ts`. It demonstrates the standard shape: mock at the system seam (`fetch`) only, run the real store and the real TanStack Query cache through a fresh per-test `QueryClient` from `createQueryTestWrapper`, and assert on observable hook output (not internal calls).

## Anti-patterns to delete on sight

- `expect(mocks.<our-own-module>).toHaveBeenCalled*(...)` — assert on the return / state / output instead.
- `vi.mock('@/lib/...')` on a module we wrote — split the unit-under-test or mock at the system seam below it.
- A test file >400 LOC that "covers a lot of cases" — collapse with `it.each` or split the module.
- An `it()` block that exists "for coverage" with no behavioural assertion — delete it.
- Snapshot tests over evolving object shapes — assert on the specific fields you care about.
- Sleep-based timing (`new Promise(r => setTimeout(r, …))`) — use `vi.useFakeTimers()` and `vi.advanceTimersByTime()`.

## Enforcement

Two CI scripts back this skill:

- `scripts/check-file-sizes.mjs` — fails if any production file >450 LOC or test file >500 LOC. A one-time `.size-budget-baseline.json` grandfather list freezes today's offenders and shrinks every phase; new violations or regressions of allowlisted files fail the build. The baseline file is deleted entirely at Phase 8.
- `scripts/check-test-boundaries.mjs` — fails if `toHaveBeenCalled*` appears in a test file targeting an application-layer mock identifier. The same baseline pattern grandfathers today's offenders; new violations fail. Integration tests under `src/test/integration/` and explicit security/leak tests are allowlisted by path.

Both scripts run in `npm test` flows and in CI. There is no warn-only mode.

## See also

- [`.github/instructions/testing.instructions.md`](../../instructions/testing.instructions.md) — single source of truth for testing rules (pyramid, naming, Playwright/Vitest specifics).
- [`tdd/SKILL.md`](../tdd/SKILL.md) — the Red–Green–Refactor practice this skill sits on top of.
- [`readable-code/SKILL.md`](../readable-code/SKILL.md) — the same readability bar applies to tests.
