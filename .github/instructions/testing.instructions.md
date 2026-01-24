---
applyTo: "**/*.{test,spec}.{ts,tsx}"
description: Testing best practices for Vitest and Playwright tests
---

# Testing Best Practices

> **📌 SINGLE SOURCE OF TRUTH**: This file defines ALL testing standards for this project. Agents and other instruction files MUST reference this file rather than duplicating testing rules.

Guidelines for writing clear, maintainable tests with Vitest (unit) and Playwright (E2E).

## Testing Philosophy: The Test Pyramid

This project follows the **Test Pyramid** pattern.

```
        /  E2E  \          ← Few, slow, high-confidence
       /----------\
      / Integration \      ← Some, moderate speed (in Vitest)
     /----------------\
    /    Unit Tests    \   ← Many, fast, focused
   ----------------------
```

**Core Principles (from authoritative sources):**

1. **"The more your tests resemble the way your software is used, the more confidence they can give you."** — Kent C. Dodds, Testing Library
2. **"Write lots of small and fast unit tests. Write some more coarse-grained tests and very few high-level tests."** — Martin Fowler, Practical Test Pyramid
3. **"Test user-visible behavior, not implementation details."** — Playwright Best Practices
4. **"Push your tests as far down the test pyramid as you can."** — Martin Fowler
5. **"If a higher-level test gives you more confidence, have it. But don't duplicate lower-level coverage."** — Martin Fowler

### What This Means for This Project

| Level | Tool | Proportion | Purpose |
|-------|------|------------|---------|
| **Unit** | Vitest | ~80% of tests | Logic, utilities, state, DOM builders |
| **E2E** | Playwright | ~20% of tests | Critical user journeys only |

> **Integration tests** in this project are "sociable unit tests" (run with Vitest). We don't have a separate integration tier — orchestrator tests and component integration tests ARE unit tests that test multiple modules together.

## Test Type Definitions (CRITICAL)

Understanding what each test type IS and ISN'T prevents overlap and waste.

### Unit Tests (Vitest)

**What they are**: Tests that verify individual functions, classes, or modules work correctly **in isolation** or with real collaborators (sociable unit tests).

**Characteristics** (per Martin Fowler, Microsoft docs):
- Run entirely in memory, fast (milliseconds)
- No external dependencies (network, filesystem, database)
- Test one "unit" — a single function, method, or class
- **Mocking**: Replace collaborators with test doubles when needed for isolation

**This project's unit tests include:**
- Pure functions (`calculateTimeRemaining()`, `formatDuration()`)
- State management (`appState`, form state)
- DOM builders (`createToast()`, `buildCountdownDisplay()`) — run in jsdom
- Event handler logic (callback invocation)
- Algorithms and utilities
- **Integration/sociable tests** (`orchestrator.integration.test.ts`) — test module interactions but run fast in memory

> **"Component tests" are unit tests**: DOM manipulation utilities like `createToast()` run in Vitest with jsdom. They test that elements are created correctly — but NOT real CSS, rendering, or browser behavior. If you need those, use E2E.

### E2E Tests (Playwright)

**What they are**: Tests that verify the application works correctly **from the user's perspective** in a real browser.

**Characteristics** (per Playwright docs, Atlassian):
- Run against the deployed application in a real browser
- Test complete user journeys ("user searches for X, clicks Y, sees Z")
- Slow (seconds), expensive, but high confidence
- Should be **few in number** — only critical paths

**This project's E2E tests cover:**
- Critical user flows (landing page → countdown → celebration)
- Theme switching via UI
- URL deep linking and browser navigation
- Accessibility (keyboard navigation, screen reader landmarks)
- Responsive behavior across viewports
- Real browser APIs (fullscreen, clipboard, notifications)

### What We DON'T Have: Separate "Integration" or "Component" Test Tiers

Many testing taxonomies include additional tiers. Here's our approach:

| Taxonomy Term | Our Approach | Rationale |
|---------------|--------------|-----------|
| **Integration tests** | Sociable unit tests (Vitest) | Tests like `orchestrator.integration.test.ts` test module interactions but run fast in memory |
| **Component tests** | Unit tests (Vitest + jsdom) | DOM builders are tested as units; real rendering needs E2E |
| **Functional tests** | E2E tests (Playwright) | User-perspective tests are E2E |
| **UI tests** | E2E tests (Playwright) | Anything needing a real browser is E2E |

**Why this simplification?** (per Google Testing Blog, CircleCI):
- Fewer test categories = clearer ownership and less duplication
- "Integration" is ambiguous — our integration tests are just unit tests with real collaborators
- Browser-based component tests add tooling complexity for marginal benefit in this project

## Test Decision Flowchart

```
┌─────────────────────────────────────────────────────────────┐
│ What are you testing?                                       │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ Does it need a real browser?                                │
│ (CSS rendering, layout, browser APIs, cross-browser)        │
└─────────────────────────────────────────────────────────────┘
         │
    YES  │  NO
         ▼     ▼
    E2E    ┌─────────────────────────────────────┐
           │ Does it test a critical user journey │
           │ spanning multiple pages/interactions?│
           └─────────────────────────────────────┘
                    │
               YES  │  NO
                    ▼     ▼
               E2E    Unit (Vitest)
```

**Simple rule**: If you can call it directly as a function → **Unit**. If you need to click/type in a browser → **E2E**.

## When to Write Each Test Type

### Write a Unit Test When...

✅ Testing a pure function with inputs/outputs
✅ Testing state transitions or reducers
✅ Testing DOM builder output (element structure, attributes)
✅ Testing event handler callbacks are invoked correctly
✅ Testing algorithms, formatters, validators
✅ Testing error handling and edge cases
✅ Testing module integration (orchestrator, controllers)
✅ You want fast feedback (milliseconds)

### Write an E2E Test When...

✅ Testing a complete user journey (login → action → result)
✅ Testing real browser behavior (fullscreen, clipboard, notifications)
✅ Testing CSS rendering and visual layout
✅ Testing keyboard navigation flows
✅ Testing responsive behavior at different viewports
✅ Testing deep linking and URL state
✅ Testing accessibility with real assistive technology behavior
✅ You need confidence the whole system works together

### DON'T Write an E2E Test When...

❌ A unit test would cover the same logic (test pyramid violation)
❌ Testing a single function's output
❌ Testing DOM structure that unit tests already verify
❌ Testing the same scenario that another E2E already covers
❌ Testing implementation details not visible to users

## Avoiding Test Duplication (CRITICAL)

> **"If a higher-level test spots an error and there's no lower-level test failing, you need to write a lower-level test."** — Martin Fowler

### The Duplication Problem

Having both unit AND E2E tests cover the same behavior wastes time:
- Slower test suites
- More tests to maintain
- False sense of coverage

### Duplication Decision Matrix

| Behavior Being Tested | Unit Test? | E2E Test? |
|----------------------|------------|-----------|
| Function returns correct value | ✅ Yes | ❌ No |
| DOM element has correct attributes | ✅ Yes | ❌ No |
| Button click invokes callback | ✅ Yes | ❌ No |
| User can navigate from A to B | ❌ No | ✅ Yes |
| Theme visually renders correctly | ❌ No | ✅ Yes |
| Keyboard focus moves correctly | ❌ No | ✅ Yes |
| Form validation shows error | ✅ Logic | ✅ Display |

**Rule**: If unit tests verify the logic, E2E tests should only verify the **integration** and **visual** aspects.

## Test Quality Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| **Unit:E2E ratio** | 4:1 to 5:1 | 2:1 | 1:1 or inverted |
| **Test:Code ratio** | 0.5:1 to 1.5:1 | <0.3:1 or >2:1 | <0.1:1 or >3:1 |
| **Assertion density** | 1-3 per test | 4-5 per test | >5 per test |
| **E2E test duration** | <30s each | 30-60s | >60s |
| **Coverage target** | ≥70% | 50-70% | <50% |

## Fixing Flaky Tests

Flaky tests erode trust, slow CI, and mask regressions. Diagnose the root cause:

| Root Cause | Symptoms | Fix Pattern |
|------------|----------|-------------|
| **Timing/Race** | Passes locally, fails in CI | Replace `waitForTimeout()` with web-first assertions |
| **Shared State** | Fails with other tests; passes alone | Reset state in `beforeEach`; ensure cleanup |
| **Order Dependency** | Fails when test order changes | Add complete cleanup in `afterEach` |
| **Time Sensitivity** | Fails near midnight | Use `vi.useFakeTimers()` with fixed dates |
| **Environment Variance** | Fails on specific OS/browser | Mock environment APIs |

## Rules and Guidelines

### Before Writing Tests

1. **Check for existing tests** — search the codebase to avoid duplication
2. **Choose the right level** — prefer unit tests; use E2E only when necessary
3. **Identify what's NOT covered** — don't duplicate existing coverage

### Test Naming

Use descriptive names following "should [expected behavior] when [condition]" pattern:

```typescript
// ❌ Vague names
it('works', () => { ... });
it('test theme', () => { ... });

// ✅ Descriptive names
it('should display countdown when mounted', () => { ... });
it('should hide days unit when days equals zero', () => { ... });
it('should clean up intervals when destroyed', () => { ... });
```

### Table-Driven Tests (Parameterized)

Use `it.each` for testing multiple scenarios with the same logic:

```typescript
// ✅ Table-driven test with clear structure
describe('formatTimeRemaining', () => {
  it.each([
    { input: { days: 1, hours: 2, minutes: 3, seconds: 4 }, expected: '01:02:03:04' },
    { input: { days: 0, hours: 1, minutes: 30, seconds: 0 }, expected: '01:30:00' },
    { input: { days: 0, hours: 0, minutes: 5, seconds: 30 }, expected: '05:30' },
  ])('should format $expected for days=$input.days hours=$input.hours', ({ input, expected }) => {
    expect(formatTimeRemainingCompact(input)).toBe(expected);
  });
});
```

**ALWAYS use `it.each` when:**
- Testing boolean/flag combinations
- Testing boundary conditions
- Testing input/output mappings
- Testing multiple error cases
- Testing enumerated states

### Test Structure (AAA Pattern)

```typescript
it('should update countdown display', () => {
  // Arrange
  const container = document.createElement('div');
  const theme = createMyTheme(new Date());
  theme.mount(container);

  // Act
  theme.updateCountdown({ days: 5, hours: 12, minutes: 30, seconds: 45, total: 500000000 });

  // Assert
  expect(container.querySelector('[data-testid="countdown-days"]')?.textContent).toBe('5');
});
```

### Test Isolation

Keep tests independent — never rely on state from other tests:

```typescript
// ✅ Each test has its own setup
describe('ThemeController', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('should mount successfully', () => {
    const theme = createTheme();
    theme.mount(container);
    expect(container.children.length).toBeGreaterThan(0);
  });
});
```

### E2E Tests (Playwright)

#### Locator Strategy (CRITICAL)

| ✅ Good Locators | ❌ Bad Locators |
|------------------|-----------------|
| `getByRole('button', { name: 'Submit' })` | `.btn-primary` |
| `getByTestId('countdown-display')` | `.countdown > div` |
| `getByLabel('Select timezone')` | `input[type="text"]` |
| `getByText('Welcome')` | `.welcome-message` |

**Priority Order**: Role → Label → TestId → Text → CSS (last resort)

#### Assertion Strategy (CRITICAL)

| ✅ Web-First (Auto-Waiting) | ❌ Manual (No Waiting) |
|-----------------------------|------------------------|
| `await expect(el).toBeVisible()` | `expect(await el.isVisible()).toBe(true)` |
| `await expect(el).toHaveText(/\d+/)` | `expect(await el.textContent()).toMatch()` |
| `await expect(spinner).not.toBeVisible()` | `await page.waitForTimeout(1000)` |

**Rule**: Prefer condition-based waits over `waitForTimeout()`. Use `waitForTimeout()` only when testing time-based behavior (animations, countdowns) where you need to wait for a specific duration.

#### URL Format by Countdown Mode

| Mode | Target Format | Example |
|------|---------------|---------|
| `timer` | `duration=<seconds>` | `?mode=timer&duration=300` |
| `wall-clock` | **No `Z` suffix** | `?mode=wall-clock&target=2026-01-01T00:00:00` |
| `absolute` | **With `Z` suffix** | `?mode=absolute&target=2026-01-01T00:00:00Z` |

### E2E Development Mode

```bash
# Default mode: chromium only, 4 parallel workers, 15s timeout, excludes @perf tests
npm run test:e2e

# Or with specific test filtering
npm run test:e2e -- --grep "theme switching"
```

> ⚠️ **IMPORTANT**: Agents should use `npm run test:e2e` (fast mode, excludes @perf tests).
> For performance tests, use `npm run test:e2e:perf` separately.
> Cross-browser testing: `npm run test:e2e:cross-browser`
>
> **Default mode configuration:**
> - `--project=chromium` - Single browser only
> - `--timeout=15000` - 15s test timeout (vs 30s in full mode)
> - `--retries=0` - No retries for faster feedback
> - `--workers=4` - Parallel execution
> - `--reporter=dot` - Compact output

### Performance Profiling Tests

Deep performance analysis tests using CDP for CPU profiling, memory leak detection, and render counting. These tests produce JSON artifacts in `test-results/perf-profiles/`.

```bash
# Run perf tests for ALL themes (audit mode)
npm run test:e2e:perf:all

# Run perf tests for a SPECIFIC theme
PERF_THEME=contribution-graph npm run test:e2e:perf

# Examples:
PERF_THEME=fireworks npm run test:e2e:perf
PERF_THEME=ring npm run test:e2e:perf
```

**Test categories** (all use `@perf` tag):
- **CPU Profiling**: 60-second animation profiling, theme switch profiling
- **Memory Leak Detection**: Theme switch cycles, prolonged animation
- **Render Counting**: Paint operations, layout shifts, DOM mutations
- **Countdown Completion**: Full 90-second countdown cycle with phase analysis
- **Long Task Detection**: Main thread blocking analysis

**When to use:**
- After optimizing a theme's rendering/animation code
- When adding a new theme (PR workflow auto-detects new themes)
- Before merging significant performance changes
- When investigating reported performance issues

**CI Integration:**
- PRs with `e2e` label that add new themes automatically run perf profiling
- Use `workflow_dispatch` to manually trigger with `run-perf: true`

### Test Configuration Details

#### Vitest (Unit Tests)

**Environment**: jsdom (DOM APIs available in Node)

**Reporters**: `dot` for compact output

**Timeouts**:
- Test timeout: 5000ms (5s per test)
- Hook timeout: 10000ms (10s for beforeAll/afterAll)
- Retries: 0 (fail fast to catch flaky tests)

**Path Aliases**:
- `@/` → `src/`
- `@app/` → `src/app/`
- `@core/` → `src/core/`
- `@themes/` → `src/themes/`

**Console Output**: Suppressed during tests for clean output

#### Playwright (E2E Tests)

**Test Organization**: Hybrid pattern (cross-cutting + theme-specific)

**Reporters**:
- CI: `blob` (for merge queues)
- Local: `dot` (compact)

**Timeouts**:
- Default mode (`test:e2e`): 15s test, 10s expect, 30s navigation (chromium, excludes @perf)
- Cross-browser mode (`test:e2e:cross-browser`): 30s test, 10s expect, 30s navigation
- Performance mode (`test:e2e:perf`): 360s test (6 minutes), chromium only, @perf tests only

**Retries**:
- Full mode: 1 retry on failure
- Fast mode: 0 retries

**Browser Projects**:
- CI: chromium only (GitHub Actions runner)
- Local full: chromium, firefox, webkit, mobile-chrome, mobile-safari, high-res
- Local fast: chromium only

**Base URL**: `http://localhost:5173/timestamp`

### What to Test at Each Level

#### Unit Tests Should Cover
- Pure functions with various inputs
- Edge cases (empty arrays, null values, boundaries)
- Error conditions and error handling
- State transitions
- Cleanup behavior
- DOM builders (structure, attributes)
- Event handler wiring

#### E2E Tests Should Cover
- Critical user flows (happy paths)
- Theme switching and visual rendering
- Accessibility features (keyboard nav, focus management)
- Responsive behavior
- Browser APIs (fullscreen, clipboard, notifications)
- Deep linking and URL state

### Theme Testing Patterns

#### Mock Spy Pattern for Delegation Testing

When testing that a renderer delegates to utility functions:

```typescript
import * as animation from '../utils/ui/animation';
import * as rendererState from '../utils/ui/state';

describe('Time Page Renderer', () => {
  it('should forward context to animation handler when animation state changes', () => {
    const theme = myThemeTimePageRenderer(new Date());
    const handlerSpy = vi.spyOn(animation, 'handleRendererAnimationStateChange')
      .mockImplementation(() => {});
    
    theme.mount(container);
    theme.onAnimationStateChange({ shouldAnimate: false, prefersReducedMotion: false });
    
    expect(handlerSpy).toHaveBeenCalledWith(
      expect.any(Object),  // state object
      { shouldAnimate: false, prefersReducedMotion: false }
    );
  });

  it('should delegate container updates to state module', () => {
    const theme = myThemeTimePageRenderer(new Date());
    const updateSpy = vi.spyOn(rendererState, 'updateRendererContainer')
      .mockImplementation(() => {});
    
    theme.updateContainer(newContainer);
    
    expect(updateSpy).toHaveBeenCalled();
  });
});
```

**When to use:**
- Testing that interface methods delegate correctly
- Verifying lifecycle hooks forward to appropriate handlers
- Avoiding deep integration tests when unit tests suffice

#### Semantic Test Helper Pattern

Create intention-revealing helper functions for test setup:

```typescript
/** Creates a mock MountContext with the given animation state. */
function createMockMountContext(state: Partial<AnimationStateContext> = {}): MountContext {
  const animationState: AnimationStateContext = {
    shouldAnimate: state.shouldAnimate ?? true,
    prefersReducedMotion: state.prefersReducedMotion ?? false,
    reason: state.reason,
  };
  return { getAnimationState: () => animationState };
}

// Usage in tests
it('should not pulse when reduced motion is preferred', () => {
  const theme = myThemeTimePageRenderer(new Date());
  const context = createMockMountContext({ prefersReducedMotion: true });
  
  theme.mount(container, context);
  theme.updateTime({ days: 0, hours: 0, minutes: 0, seconds: 1, total: 1000 });
  
  expect(container.querySelectorAll('.pulse-digit')).toHaveLength(0);
});
```

### File Organization

**Unit tests**: Co-located next to source files (`.test.ts`)
- Source tests: `src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`
- Build script tests: `scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}`
- Excluded: `node_modules/`, `e2e/` (handled by Playwright)

**E2E tests**: Hybrid pattern:
- Theme-specific E2E: `src/themes/<theme>/e2e/**/*.spec.ts`
- Cross-cutting E2E: `e2e/**/*.spec.ts`

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| **E2E for pure functions** | Slow, wrong tool | Use unit tests |
| **Unit tests for UI flows** | Can't test browser behavior | Use E2E tests |
| **Duplicate coverage** | Wastes time, maintenance burden | Test at lowest possible level |
| **Testing implementation details** | Breaks on refactor | Test observable behavior |
| **`waitForTimeout()` for waiting on conditions** | Flaky, slow | Use web-first assertions (`toBeVisible()`, etc.) |
| **CSS selectors in E2E** | Break on styling changes | Use semantic locators |
| **Tests without assertions** | False confidence | Include explicit `expect()` |
| **Individual tests for combinations** | Verbose, repetitive | Use `it.each()` |
| **Over-mocking** | Tests pass but code is broken | Mock only at boundaries |

## References

### Authoritative Sources
- [Martin Fowler: Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Playwright: Best Practices](https://playwright.dev/docs/best-practices)
- [Testing Library: Guiding Principles](https://testing-library.com/docs/guiding-principles)
- [Microsoft: Test ASP.NET Core MVC Apps](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/test-asp-net-core-mvc-apps)
- [Atlassian: Types of Software Testing](https://www.atlassian.com/continuous-delivery/software-testing/types-of-software-testing)
- [BrowserStack: Unit vs Integration Testing](https://www.browserstack.com/guide/unit-testing-vs-integration-testing)
- [CircleCI: Unit vs Integration Testing](https://circleci.com/blog/unit-testing-vs-integration-testing/)

### Related Instructions
- [typescript.instructions.md](typescript.instructions.md) - TypeScript coding standards
- [themes.instructions.md](themes.instructions.md) - Theme testing patterns
- [perf-analysis.instructions.md](perf-analysis.instructions.md) - Performance testing
- [pwa.instructions.md](pwa.instructions.md) - PWA testing patterns

### External Documentation
- [Vitest Documentation](https://vitest.dev/) - Unit testing framework
- [Playwright Documentation](https://playwright.dev/) - E2E testing framework
