/**
 * Vitest Test Setup
 *
 * Global setup for Vitest tests. Runs before each test file.
 */

import '@testing-library/jest-dom/vitest';

// Mock fetch globally for API tests
global.fetch = vi.fn();

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

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
