import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSpan: vi.fn(),
  end: vi.fn(),
  setAttribute: vi.fn(),
  getTracer: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: (name: string) => {
      mocks.getTracer(name);
      return {
        startSpan: (n: string, opts: unknown) => {
          mocks.startSpan(n, opts);
          return {
            setAttribute: (k: string, v: unknown) => mocks.setAttribute(k, v),
            end: () => mocks.end(),
          };
        },
      };
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

async function load() {
  vi.resetModules();
  return import('./navigation-span');
}

describe('recordNavigation', () => {
  it('emits a page.navigation span with path attributes', async () => {
    const { recordNavigation } = await load();

    recordNavigation('/dashboard', '/');

    expect(mocks.getTracer).toHaveBeenCalledWith('flight-school-browser-navigation');
    expect(mocks.startSpan).toHaveBeenCalledWith('page.navigation', expect.any(Object));
    expect(mocks.setAttribute).toHaveBeenCalledWith('page.path', '/dashboard');
    expect(mocks.setAttribute).toHaveBeenCalledWith('page.previous_path', '/');
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it('omits previous_path attribute when undefined', async () => {
    const { recordNavigation } = await load();

    recordNavigation('/home', undefined);

    expect(mocks.setAttribute).toHaveBeenCalledWith('page.path', '/home');
    expect(mocks.setAttribute).not.toHaveBeenCalledWith('page.previous_path', expect.anything());
  });
});
