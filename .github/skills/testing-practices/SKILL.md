---
name: testing-practices
description: Testing best practices for Vitest and Playwright. Use when writing tests, debugging test failures, or reviewing test code.
---

# Testing Practices

Comprehensive testing guidelines using Vitest (unit) and Playwright (E2E).

## When to Use This Skill

- Writing new tests (unit or E2E)
- Debugging flaky or failing tests
- Reviewing test code
- Questions about testing strategy

## Testing Philosophy: The Test Pyramid

```
        /  E2E  \          ← Few, slow, high-confidence
       /----------\
      / Integration \      ← Some, moderate speed (in Vitest)
     /----------------\
    /    Unit Tests    \   ← Many, fast, focused
   ----------------------
```

| Level | Tool | Proportion | Purpose |
|-------|------|------------|---------|
| **Unit** | Vitest | ~80% of tests | Logic, utilities, state, DOM builders |
| **E2E** | Playwright | ~20% of tests | Critical user journeys only |

## Test Decision Flowchart

**Simple rule**: If you can call it directly as a function → **Unit**. If you need to click/type in a browser → **E2E**.

### Write a Unit Test When...

✅ Testing a pure function with inputs/outputs
✅ Testing state transitions or reducers
✅ Testing DOM builder output (element structure, attributes)
✅ Testing event handler callbacks
✅ Testing algorithms, formatters, validators
✅ Testing error handling and edge cases
✅ You want fast feedback (milliseconds)

### Write an E2E Test When...

✅ Testing a complete user journey
✅ Testing real browser behavior (fullscreen, clipboard, notifications)
✅ Testing CSS rendering and visual layout
✅ Testing keyboard navigation flows
✅ Testing responsive behavior at different viewports
✅ Testing deep linking and URL state

### DON'T Write an E2E Test When...

❌ A unit test would cover the same logic (test pyramid violation)
❌ Testing a single function's output
❌ Testing DOM structure that unit tests already verify
❌ Testing the same scenario that another E2E already covers

## Test Naming

Use "should [expected behavior] when [condition]" pattern:

```typescript
// ❌ Vague names
it('works', () => { ... });
it('test theme', () => { ... });

// ✅ Descriptive names
it('should display countdown when mounted', () => { ... });
it('should hide days unit when days equals zero', () => { ... });
it('should clean up intervals when destroyed', () => { ... });
```

## Table-Driven Tests (Parameterized)

Use `it.each` for testing multiple scenarios:

```typescript
describe('formatTimeRemaining', () => {
  it.each([
    { input: { days: 1, hours: 2, minutes: 3, seconds: 4 }, expected: '01:02:03:04' },
    { input: { days: 0, hours: 1, minutes: 30, seconds: 0 }, expected: '01:30:00' },
    { input: { days: 0, hours: 0, minutes: 5, seconds: 30 }, expected: '05:30' },
  ])('should format $expected', ({ input, expected }) => {
    expect(formatTimeRemainingCompact(input)).toBe(expected);
  });
});
```

**ALWAYS use `it.each` when:**
- Testing boolean/flag combinations
- Testing boundary conditions
- Testing input/output mappings
- Testing multiple error cases

## Test Structure (AAA Pattern)

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

## Test Isolation

Keep tests independent — never rely on state from other tests:

```typescript
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

## E2E Tests (Playwright)

### Locator Strategy (CRITICAL)

| ✅ Good Locators | ❌ Bad Locators |
|------------------|-----------------|
| `getByRole('button', { name: 'Submit' })` | `.btn-primary` |
| `getByTestId('countdown-display')` | `.countdown > div` |
| `getByLabel('Select timezone')` | `input[type="text"]` |
| `getByText('Welcome')` | `.welcome-message` |

**Priority Order**: Role → Label → TestId → Text → CSS (last resort)

### Assertion Strategy (CRITICAL)

| ✅ Web-First (Auto-Waiting) | ❌ Manual (No Waiting) |
|-----------------------------|------------------------|
| `await expect(el).toBeVisible()` | `expect(await el.isVisible()).toBe(true)` |
| `await expect(el).toHaveText(/\d+/)` | `expect(await el.textContent()).toMatch()` |
| `await expect(spinner).not.toBeVisible()` | `await page.waitForTimeout(1000)` |

**Rule**: Prefer condition-based waits over `waitForTimeout()`.

### E2E Commands

```bash
# Default mode: chromium only, 4 parallel workers, excludes @perf tests
npm run test:e2e

# With specific test filtering
npm run test:e2e -- --grep "theme switching"

# Full suite (all browsers)
npm run test:e2e:full
```

## Fixing Flaky Tests

| Root Cause | Symptoms | Fix Pattern |
|------------|----------|-------------|
| **Timing/Race** | Passes locally, fails in CI | Replace `waitForTimeout()` with web-first assertions |
| **Shared State** | Fails with other tests | Reset state in `beforeEach` |
| **Order Dependency** | Fails when order changes | Add complete cleanup in `afterEach` |
| **Time Sensitivity** | Fails near midnight | Use `vi.useFakeTimers()` with fixed dates |
| **Environment Variance** | Fails on specific OS | Mock environment APIs |

## Test Configuration

### Vitest (Unit Tests)

- **Environment**: jsdom (DOM APIs available)
- **Timeout**: 5000ms per test
- **Retries**: 0 (fail fast)
- **Path Aliases**: `@/` → `src/`, `@core/` → `src/core/`

### Playwright (E2E Tests)

- **Default mode**: chromium only, 15s timeout, excludes @perf
- **Full mode**: all browsers, 30s timeout, 1 retry
- **Base URL**: `http://localhost:5173/timestamp`

## File Organization

**Unit tests**: Co-located with source (`foo.ts` + `foo.test.ts`)

```
feature/
├── feature.ts
├── feature.test.ts
├── utils.ts
└── utils.test.ts
```

**E2E tests**: Hybrid pattern
- Theme-specific: `src/themes/<theme>/e2e/**/*.spec.ts`
- Cross-cutting: `e2e/**/*.spec.ts`

## Test Quality Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| **Unit:E2E ratio** | 4:1 to 5:1 | 2:1 | 1:1 or inverted |
| **Test:Code ratio** | 0.5:1 to 1.5:1 | <0.3:1 | <0.1:1 |
| **E2E test duration** | <30s each | 30-60s | >60s |
| **Coverage target** | ≥70% | 50-70% | <50% |

## Mock Spy Pattern for Delegation Testing

```typescript
import * as animation from '../utils/ui/animation';

describe('Time Page Renderer', () => {
  it('should forward context to animation handler', () => {
    const theme = myThemeTimePageRenderer(new Date());
    const handlerSpy = vi.spyOn(animation, 'handleRendererAnimationStateChange')
      .mockImplementation(() => {});
    
    theme.mount(container);
    theme.onAnimationStateChange({ shouldAnimate: false, prefersReducedMotion: false });
    
    expect(handlerSpy).toHaveBeenCalledWith(
      expect.any(Object),
      { shouldAnimate: false, prefersReducedMotion: false }
    );
  });
});
```

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| E2E for pure functions | Slow, wrong tool | Use unit tests |
| Unit tests for UI flows | Can't test browser behavior | Use E2E tests |
| Duplicate coverage | Wastes time | Test at lowest possible level |
| Testing implementation details | Breaks on refactor | Test observable behavior |
| `waitForTimeout()` for conditions | Flaky, slow | Use web-first assertions |
| CSS selectors in E2E | Break on styling changes | Use semantic locators |
| Tests without assertions | False confidence | Include explicit `expect()` |
| Over-mocking | Tests pass but code is broken | Mock only at boundaries |

## References

- [Martin Fowler: Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html)
- [Playwright: Best Practices](https://playwright.dev/docs/best-practices)
- [Vitest Documentation](https://vitest.dev/)
