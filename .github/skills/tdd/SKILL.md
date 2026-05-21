# TDD Skill

## Overview

Test-Driven Development (TDD) is a tight, behaviour-first development loop:

1. **Red** — write a failing test that describes the next behaviour you want.
2. **Green** — write the smallest amount of production code that makes the test pass.
3. **Refactor** — improve the internal structure of the code (and the test) without changing observable behaviour. The just-written test is your safety net.

You repeat the loop one small behaviour at a time. Each cycle is typically seconds to a few minutes — not hours.

**Why TDD matters in this codebase**:

- **Regression safety** — every behaviour ships with a test that prevents it from silently breaking later. This matters most for security-sensitive code (`src/lib/security/`), multi-tenant isolation, and rate limiting.
- **Design feedback** — if a test is painful to write, the design is usually wrong (too many collaborators, hidden globals, time-coupled state). TDD surfaces those problems before the production code calcifies around them.
- **Documentation** — the test file is the executable specification. New contributors read `*.test.ts` next to a module to understand what it actually guarantees.

TDD is not "write tests after". The discipline is the order: failing test **first**, then code.

## Authoritative reference

> **All testing rules in this repo live in [`.github/instructions/testing.instructions.md`](../../instructions/testing.instructions.md).**

That file is the single source of truth for: the test pyramid, what counts as a unit vs. E2E test, naming, mocking policy, and Playwright/Vitest specifics. This skill describes **how to *practise* TDD on top of those rules** — it does not redefine them.

## The Red–Green–Refactor loop in this repo

### Red — write the failing test first

Start by encoding the next behaviour as a test. The test must fail for the *right reason* before you write any production code. "Right reason" means the assertion fails, not that the import is missing or there's a typo.

Real example from this codebase — [`src/lib/security/rate-limit.test.ts`](../../../src/lib/security/rate-limit.test.ts):

```ts
it('allows requests up to the limit and blocks beyond it', () => {
  for (let i = 0; i < 3; i += 1) {
    expect(checkRateLimit('user-1', 3, 60_000).allowed).toBe(true);
  }
  const blocked = checkRateLimit('user-1', 3, 60_000);
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterMs).toBeGreaterThan(0);
});
```

Notice what this test does well:

- Describes **behaviour** ("allows N, blocks N+1"), not implementation (no peeking at the internal map).
- Asserts on the **public return shape** (`allowed`, `retryAfterMs`).
- Uses concrete, readable numbers (`3`, `60_000`) instead of cleverly named constants.

Another good "red" pattern — cross-user leak tests in [`src/test/integration/multitenancy.test.ts`](../../../src/test/integration/multitenancy.test.ts):

```ts
describe('multi-tenant auth/token isolation', () => {
  // ...mocks omitted for brevity
  it('does not reuse user A token for user B requests', async () => {
    // exercises the system with two distinct tokens and asserts
    // that no cross-contamination occurs.
  });
});
```

Write the leak test **before** you trust the isolation code. If you can't make the test fail by deleting the isolation logic, the test isn't proving anything.

### Green — minimum code to pass

Once red is red for the right reason, write the **simplest** thing that turns it green:

- Hardcode a return value if that's all the test demands.
- Add a single `if` branch rather than a whole abstraction.
- Resist the urge to add the second feature ("while I'm here…"). The next failing test will pull it out of you naturally.

The goal of green is not "good code". The goal is "passing test, fast feedback". Quality comes in the next step.

### Refactor — now improve structure

With a green bar, you can safely:

- Extract helpers and rename for clarity.
- Collapse duplication between the test and the implementation.
- Tighten types, narrow visibility (`export` → file-local), remove dead branches.
- Improve the **test** too — extract setup helpers, rename, deduplicate.

Run the test after each small refactor. If it goes red, undo the last change. The cycle is: tiny edit → test → tiny edit → test.

Do **not** add new behaviour during refactor. New behaviour requires a new failing test (back to red).

## How TDD fits Vitest in this repo

### Commands

```bash
# TDD inner loop — re-runs tests on every save. Use this while coding.
npm run test:watch

# Full run — what CI and pre-commit will do.
npm test

# Coverage — useful occasionally to find untested branches, not every cycle.
npm run test:coverage
```

`npm run test:watch` is the TDD workflow. Keep it running in a side terminal. Save a file → see the bar flip red or green within a second or two.

### Project mocking conventions

The project has standardised mocks defined in [`src/test/setup.ts`](../../../src/test/setup.ts) — `global.fetch`, `window.matchMedia`, and `document.adoptedStyleSheets` are stubbed for every test, and `vi.clearAllMocks()` runs in a global `beforeEach`. Don't re-mock those at the file level.

**Environment variables — use `vi.stubEnv`**, not `process.env.X = …`. Example from [`src/lib/github/client.test.ts`](../../../src/lib/github/client.test.ts):

```ts
it('uses GITHUB_TOKEN when set', async () => {
  vi.stubEnv('GITHUB_TOKEN', 'ghp_test_token_123');
  const token = await getGitHubToken();
  expect(token).toBe('ghp_test_token_123');
});
```

`vi.stubEnv` is auto-restored by Vitest between tests, so you don't need an `afterEach` to undo it.

**Module mocks — use `vi.mock` at top of file**, with the import *after* the mock. Example from [`src/test/integration/multitenancy.test.ts`](../../../src/test/integration/multitenancy.test.ts):

```ts
vi.mock('@github/copilot-sdk', () => {
  class CopilotClient {
    createSession = createSessionMock;
  }
  return { CopilotClient, approveAll: vi.fn() };
});

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation(/* … */),
}));

// Imports come AFTER vi.mock — Vitest hoists the mock above them.
import { getOctokitForToken } from '@/lib/github/client';
```

For `next-auth/jwt` and other auth-layer modules, follow the same pattern: declare the mock factory at the top, then import the system-under-test.

## Patterns from this codebase you should mimic

### Leak tests — cross-user/cross-tenant assertions

In [`src/test/integration/multitenancy.test.ts`](../../../src/test/integration/multitenancy.test.ts) the suite drives the system with two different tokens (`TOKEN_A`, `TOKEN_B`) and asserts that data, mocks, and sessions for user A never appear in user B's calls. When you add a feature that holds per-user state (caches, sessions, tokens, audit logs), write a leak test of this shape:

```ts
it('does not leak state between users', () => {
  doSomethingAs('user-a');
  const resultB = doSomethingAs('user-b');
  expect(resultB).not.toContain('user-a-data');
});
```

If you cannot make this test fail by *deliberately* breaking the isolation, the test isn't actually checking isolation — rewrite it until you can.

### State reset — expose a test-only reset hook

Modules that hold process-global state should export a reset function intended purely for tests. Example: [`src/lib/security/rate-limit.ts`](../../../src/lib/security/rate-limit.ts) exports `__resetRateLimitState()`, and its test file calls it in `afterEach`:

```ts
afterEach(() => {
  __resetRateLimitState();
  vi.useRealTimers();
});
```

Conventions:

- Prefix with `__` to signal "internal, not part of the public API".
- Document it as test-only in TSDoc.
- Always pair it with restoring fake timers / stubbed modules in the same hook.

This is much safer than relying on test files to construct fresh modules — it keeps tests independent without per-test module reloading.

### Deterministic clocks — `vi.useFakeTimers()` for time-based logic

Any code with TTLs, sliding windows, retries, or session expiry must be tested with fake timers. From `rate-limit.test.ts`:

```ts
it('slides the window so old timestamps eventually expire', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

  for (let i = 0; i < 3; i += 1) {
    expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(true);
  }
  expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(false);

  vi.advanceTimersByTime(1_500);
  expect(checkRateLimit('user-1', 3, 1_000).allowed).toBe(true);
});
```

Always pair `vi.useFakeTimers()` with `vi.useRealTimers()` in `afterEach`, and prefer `vi.setSystemTime` over relying on "now" being any particular value.

## Anti-patterns to avoid

- **Asserting implementation details.** Don't assert that an internal `Map` has size 1, that a private helper was called, or that a particular `if` branch ran. Assert on the *return value* and *observable side effects*. If you must spy on an internal call, ask whether the seam belongs at a higher level.
- **Snapshot tests for everything.** Snapshots are useful for stable, intentional output (e.g. a rendered Markdown string). They are noise for object shapes that legitimately evolve — they encourage "press `u` to update" rather than thinking about whether the change was intended.
- **Order-dependent tests.** Each test must pass when run in isolation (`vitest run -t 'name of test'`). If a test only passes because a previous test seeded global state, fix the test, not the test runner config. Use the project's `__reset*` helpers, fresh mocks in `beforeEach`, or proper scoping.
- **Sleep-based timing tests.** Never use `await new Promise(r => setTimeout(r, 1500))` to wait for a timeout to elapse — that makes the suite slow and flaky on CI. Use `vi.useFakeTimers()` + `vi.advanceTimersByTime(1_500)` instead.
- **Testing the mock.** If the only thing under test is "the mock returned what I told it to", you've tested nothing. Mocks should stand in for *boundaries*; the assertions should be about how the real code reacts to the boundary's behaviour.

## TDD checklist for a new feature

When the next behaviour is small enough to hold in your head, do this in order:

1. **Write the failing test.** Encode one behaviour. Name it after the behaviour, not the function (`'blocks requests beyond the limit'`, not `'checkRateLimit works'`).
2. **Run `npm run test:watch`.** Confirm it fails — and fails for the *right reason* (assertion, not import error or typo).
3. **Make it pass with the simplest code.** Hardcode if necessary. The next test will force the generalisation.
4. **Refactor with the test as safety net.** Rename, extract, narrow types, deduplicate. Keep the bar green after each small edit.
5. **Repeat for the next behaviour.** One test, one behaviour, one cycle. Resist batching.

If at any point you find yourself debugging without a failing test on screen, stop and write the failing test first. That's the discipline.

## See also

- [`.github/instructions/testing.instructions.md`](../../instructions/testing.instructions.md) — authoritative testing rules (pyramid, mocking, naming, Playwright vs. Vitest).
- [`.github/skills/tsdocs/SKILL.md`](../tsdocs/SKILL.md) — how to document the behaviour your tests now lock in.
- [`.github/skills/solid/SKILL.md`](../solid/SKILL.md) — design principles that make code easy to test (and that TDD pressures you toward naturally).
