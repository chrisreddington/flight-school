/**
 * Vitest Test Setup
 *
 * Global setup for Vitest tests. Runs before each test file.
 */

import '@testing-library/jest-dom/vitest';

// Tests don't go through a real OAuth flow, but middleware now requires this.
process.env.AUTH_SECRET ??= 'test-auth-secret-do-not-use-in-prod';
// Stable salt so audit-hash assertions are deterministic across tests and
// the hash-comparison helpers in audit-determinism.test.ts don't depend on
// a per-boot random value.
process.env.AUDIT_SALT ??= 'test-audit-salt-do-not-use-in-prod';

// Mock fetch globally for API tests
global.fetch = vi.fn();

// jsdom-only globals. Guarded so a future `// @vitest-environment node`
// test file can `import` this setup without crashing on `window`.
if (typeof window !== 'undefined') {
  // Mock matchMedia for Primer React components
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  if (!('adoptedStyleSheets' in document)) {
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      get: () => [],
      set: () => undefined,
    });
  }

  // Primer's SplitPageLayout.Pane uses ResizeObserver (via useOverflow) to
  // toggle scroll affordances. jsdom doesn't implement it, so provide a no-op
  // stub — layout tests assert on structure, not measured overflow.
  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, 'ResizeObserver', {
      writable: true,
      configurable: true,
      value: ResizeObserverStub,
    });
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
}

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
